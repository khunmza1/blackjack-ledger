import React, { useState, useEffect, useMemo } from 'react';
import { initializeApp } from "firebase/app";
import { getAuth, signInAnonymously, onAuthStateChanged } from "firebase/auth";
import { getFirestore, doc, setDoc, onSnapshot, getDoc, collection, query, where, getDocs, serverTimestamp, orderBy, limit } from "firebase/firestore";

// --- Firebase Config & Initialization ---
// Reads from Environment Variables for security
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

const appId = 'blackjack-ledger-default';
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// --- Main App Component ---
export default function App() {
  const [view, setView] = useState('landing');
  const [isLoading, setIsLoading] = useState(true);
  const [sessionActive, setSessionActive] = useState(false);
  const [sessionId, setSessionId] = useState(null);
  const [currentSession, setCurrentSession] = useState(null);
  const [roundData, setRoundData] = useState({});
  const [favoritePlayers, setFavoritePlayers] = useState([]);
  const [availableSessions, setAvailableSessions] = useState([]);
  const [modal, setModal] = useState({ isOpen: false, type: null, data: null });
  const [userIp, setUserIp] = useState('...');
  const [landscapeState, setLandscapeState] = useState({ activePlayerIndex: 0, activeHandIndex: 0 });

  // --- Effects for Data Fetching and Subscriptions ---
  useEffect(() => {
    console.log("App initializing, setting up auth listener...");
    const unsubscribeAuth = onAuthStateChanged(auth, async (user) => {
      if (user) {
        console.log("Auth state changed: User is signed in with UID:", user.uid);
        try {
          await fetchFavoritePlayers();
          await fetchRecentSessions();
          const ipRes = await fetch('https://api.ipify.org?format=json');
          const ipData = await ipRes.json();
          setUserIp(ipData.ip);
        } catch (error) {
          console.error("Data fetching failed after auth:", error);
        } finally {
          setIsLoading(false);
        }
      } else {
        console.log("Auth state changed: No user found, attempting anonymous sign-in.");
        try {
            await signInAnonymously(auth);
            console.log("Anonymous sign-in successful.");
        } catch (error) {
            console.error("Anonymous sign-in failed:", error);
            setIsLoading(false);
        }
      }
    });

    return () => unsubscribeAuth();
  }, []);

  useEffect(() => {
    if (!sessionId) return;
    console.log(`Subscribing to session: ${sessionId}`);
    const sessionRef = doc(db, `artifacts/${appId}/public/data/blackjack-sessions`, sessionId);
    const unsubscribe = onSnapshot(sessionRef, (doc) => {
      if (doc.exists()) {
        const sessionData = doc.data();
        console.log("Received session update:", sessionData);
        setCurrentSession(sessionData);
        if (Object.keys(roundData).length === 0 || sessionData.players.length !== Object.keys(roundData).length) {
            initializeRoundData(sessionData.players);
        }
      } else {
        console.error("Session not found in snapshot!");
        handleGoToMainMenu();
      }
    }, (error) => {
        console.error("Error in session snapshot listener:", error);
    });
    return () => unsubscribe();
  }, [sessionId]);


  // --- Data Fetching Functions ---
  const fetchFavoritePlayers = async () => {
    console.log("Fetching favorite players...");
    try {
        const playersRef = collection(db, `artifacts/${appId}/public/data/blackjack_players`);
        // FIX: Fetch all players and filter client-side to avoid indexing issues.
        const querySnapshot = await getDocs(playersRef);
        const allPlayers = querySnapshot.docs.map(doc => doc.data());
        const favorites = allPlayers.filter(p => p.isFavorite === true);
        console.log("Favorite players found:", favorites);
        setFavoritePlayers(favorites);
    } catch (error) {
        console.error("Error fetching favorite players:", error);
    }
  };

  const fetchRecentSessions = async () => {
    console.log("Fetching recent sessions...");
    try {
        const sessionsRef = collection(db, `artifacts/${appId}/public/data/blackjack-sessions`);
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        
        const q = query(sessionsRef, where("createdAt", ">=", thirtyDaysAgo), limit(50));
        const querySnapshot = await getDocs(q);
        
        const sessions = querySnapshot.docs
            .map(doc => ({ id: doc.id, data: doc.data() }))
            .sort((a, b) => b.data.createdAt.toMillis() - a.data.createdAt.toMillis())
            .map(doc => doc.id);

        console.log("Recent sessions found:", sessions);
        setAvailableSessions(sessions);
    } catch (error) {
        console.error("Error fetching recent sessions:", error);
    }
  };

  // --- State and Game Logic Functions ---
  const initializeRoundData = (players) => {
    const newRoundData = {};
    players.forEach(player => {
      newRoundData[player.id] = {
        hands: [{ bet: player.lastBet || 20, outcome: 'lose' }]
      };
    });
    setRoundData(newRoundData);
    setLandscapeState({ activePlayerIndex: 0, activeHandIndex: 0 });
  };
  
  const handleStartNewSession = async () => {
    const datePrefix = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const sessionsRef = collection(db, `artifacts/${appId}/public/data/blackjack-sessions`);
    const q = query(sessionsRef, where('id', '>=', datePrefix), where('id', '<', datePrefix + 'z'));
    const todaysSessions = await getDocs(q);
    const nextId = `${datePrefix}-${todaysSessions.size + 1}`;
    const newSession = { id: nextId, createdAt: serverTimestamp(), players: [], transactionLog: [], chipValue: 1, dealerId: null };
    
    await setDoc(doc(db, `artifacts/${appId}/public/data/blackjack-sessions`, nextId), newSession);
    await fetchRecentSessions();
    setSessionId(nextId);
    setSessionActive(true);
    setView('game');
  };

  const handleLoadSession = (sid) => {
    if (!sid) return;
    setSessionId(sid);
    setSessionActive(true);
    setView('game');
  };

  const handleGoToMainMenu = () => {
    setSessionId(null);
    setCurrentSession(null);
    setSessionActive(false);
    setView('landing');
  };

  const updateSession = async (updatedSession) => {
    setCurrentSession(updatedSession);
    const sessionRef = doc(db, `artifacts/${appId}/public/data/blackjack-sessions`, sessionId);
    await setDoc(sessionRef, updatedSession, { merge: true });
  };
  
  const handleRecordRound = () => {
      const { players, dealerId } = currentSession;
      let dealerNet = 0;
      const updatedPlayers = JSON.parse(JSON.stringify(players));

      Object.keys(roundData).forEach(playerId => {
          if (playerId === dealerId) return;
          const player = updatedPlayers.find(p => p.id === playerId);
          if (!player) return;
          const playerRoundData = roundData[playerId];
          let playerTotal = 0;
          
          playerRoundData.hands.forEach(hand => {
              const betAmount = hand.bet;
              let amount = 0;
              switch(hand.outcome) {
                  case 'win': amount = betAmount; break;
                  case 'lose': amount = -betAmount; break;
                  case 'blackjack': amount = betAmount * 1.5; break;
                  case 'push': amount = 0; break;
              }
              playerTotal += amount;
          });

          player.balance += playerTotal;
          dealerNet -= playerTotal;
          const firstHand = playerRoundData.hands[0];
          player.lastBet = firstHand.originalBet || firstHand.bet;
      });
      
      const dealer = updatedPlayers.find(p => p.id === dealerId);
      if (dealer) dealer.balance += dealerNet;
      
      updateSession({ ...currentSession, players: updatedPlayers });
      initializeRoundData(updatedPlayers);
  };

  // --- Modal Logic ---
  const openModal = (type, data) => setModal({ isOpen: true, type, data });
  const closeModal = () => setModal({ isOpen: false, type: null, data: null });

  // --- Render Logic ---
  const renderContent = () => {
    if (isLoading) return <p className="loading">Loading...</p>;
    if (!sessionActive) {
      return <SessionManager 
                availableSessions={availableSessions} 
                onStartNew={handleStartNewSession} 
                onLoad={handleLoadSession} 
             />;
    }
    if (view === 'settlement') {
      return <SettlementView 
                session={currentSession}
                onBackToGame={() => setView('game')}
                onMainMenu={handleGoToMainMenu}
                onOpenModal={openModal}
             />;
    }
    if (view === 'game' && currentSession) {
      return <GameView 
                session={currentSession}
                favoritePlayers={favoritePlayers}
                roundData={roundData}
                setRoundData={setRoundData}
                onUpdateSession={updateSession}
                onEndSession={() => setView('settlement')}
                onOpenModal={openModal}
                onRecordRound={handleRecordRound}
             />;
    }
    return null;
  };

  return (
    <>
      <div id="desktop-view" className="app-container">
        <header>
          <h1>Blackjack Night Ledger</h1>
          <p id="session-status">
            {sessionId ? `Live Session: ${sessionId}` : 'No active session.'}
          </p>
        </header>
        <main>
          {renderContent()}
        </main>
        <footer className="footer">
          <p>&copy; 2024 - Built with React & Vite. Your IP: {userIp}</p>
        </footer>
      </div>
      <div id="landscape-view">
        {sessionActive && view === 'game' && currentSession &&
          <LandscapeView 
            session={currentSession}
            roundData={roundData}
            setRoundData={setRoundData}
            landscapeState={landscapeState}
            setLandscapeState={setLandscapeState}
            onRecordRound={handleRecordRound}
          />
        }
      </div>
      <Modal modal={modal} closeModal={closeModal} session={currentSession} onUpdateSession={updateSession} favoritePlayers={favoritePlayers} onUpdateFavorites={fetchFavoritePlayers} />
    </>
  );
}

// --- Sub-Components ---

const SessionManager = ({ availableSessions, onStartNew, onLoad }) => (
  <div className="card max-w-lg mx-auto">
    <h2 className="section-title">Session Management</h2>
    <div className="space-y-4">
      <button onClick={onStartNew} className="btn btn-primary w-full">Start New Session</button>
      <div>
        <label htmlFor="session-select" className="block text-sm font-medium text-gray-400 mb-1">Or load a recent session:</label>
        <select id="session-select" className="form-input" onChange={(e) => onLoad(e.target.value)}>
          <option value="">-- Select a Session --</option>
          {availableSessions.map(sid => <option key={sid} value={sid}>{sid}</option>)}
        </select>
      </div>
    </div>
  </div>
);

const GameView = ({ session, favoritePlayers, roundData, setRoundData, onUpdateSession, onEndSession, onOpenModal, onRecordRound }) => {
  const players = session.players || [];
  
  const handleAddPlayer = async (name) => {
      name = name.trim();
      if (!name || players.some(p => p.name.toLowerCase() === name.toLowerCase())) return;
      
      const playerRef = doc(db, `artifacts/${appId}/public/data/blackjack_players`, name);
      const playerDoc = await getDoc(playerRef);
      const promptPayId = playerDoc.exists() ? playerDoc.data().promptPayId : '';

      const newPlayer = { id: crypto.randomUUID(), name, balance: 0, promptPayId, lastBet: 20 };
      const updatedPlayers = [...players, newPlayer];
      
      const updatedSession = { ...session, players: updatedPlayers };
      if (updatedPlayers.length > 0 && !session.dealerId) {
        updatedSession.dealerId = updatedPlayers[0].id;
      }
      
      onUpdateSession(updatedSession);
  };

  const handleRemovePlayer = (playerId) => {
      let updatedPlayers = players.filter(p => p.id !== playerId);
      const updatedSession = { ...session, players: updatedPlayers };
      if (session.dealerId === playerId) {
          updatedSession.dealerId = updatedPlayers.length > 0 ? updatedPlayers[0].id : null;
      }
      onUpdateSession(updatedSession);
  };

  return (
    <div className="game-grid">
      <div className="col-span-1 space-y-6">
        <PlayerSetup players={players} favoritePlayers={favoritePlayers} onAddPlayer={handleAddPlayer} onRemovePlayer={handleRemovePlayer} onOpenModal={onOpenModal} />
      </div>
      <div className="col-span-2 space-y-6">
        <RoundRecorder 
            session={session}
            roundData={roundData} 
            setRoundData={setRoundData} 
            onUpdateSession={onUpdateSession}
            onRecordRound={onRecordRound}
        />
        <PlayerStandings players={players} onEndSession={onEndSession} onOpenModal={onOpenModal} />
      </div>
    </div>
  );
};

const PlayerSetup = ({ players, favoritePlayers, onAddPlayer, onRemovePlayer, onOpenModal }) => {
  const [newName, setNewName] = useState('');

  const handleAdd = () => {
    onAddPlayer(newName);
    setNewName('');
  };
  
  return (
    <div className="card">
      <h2 className="section-title">Players</h2>
      <div className="space-y-2 mb-4">
        {players.map(p => (
          <div key={p.id} className="player-item">
            <span>{p.name}</span>
            <div className="player-item-actions">
              <button onClick={() => onOpenModal('edit-player', { playerId: p.id })} className="btn btn-secondary !p-2">Edit</button>
              <button onClick={() => onRemovePlayer(p.id)} className="btn btn-danger !p-2">X</button>
            </div>
          </div>
        ))}
      </div>
      <div className="space-y-2">
        <label className="block text-sm font-medium text-gray-400">Quick Add:</label>
        <div className="flex flex-wrap gap-2">
          {favoritePlayers.map(fav => <button key={fav.name} onClick={() => onAddPlayer(fav.name)} className="btn btn-secondary">+ {fav.name}</button>)}
        </div>
        <div className="flex gap-2 pt-2">
          <input type="text" value={newName} onChange={e => setNewName(e.target.value)} className="form-input" placeholder="Or add manually" />
          <button onClick={handleAdd} className="btn btn-primary">+</button>
        </div>
      </div>
    </div>
  );
};

const RoundRecorder = ({ session, roundData, setRoundData, onUpdateSession, onRecordRound }) => {
    const { players, dealerId } = session;
    if (players.length < 2) return <div className="card"><p>Add at least 2 players to start.</p></div>;

    const setSelectedDealerId = (newDealerId) => {
        onUpdateSession({ ...session, dealerId: newDealerId });
    };

    return (
        <div className="card">
            <h2 className="section-title">Record Round</h2>
            <div className="mb-4">
                <label htmlFor="dealer-select" className="block text-sm font-medium text-gray-400 mb-1">Dealer This Round</label>
                <select id="dealer-select" className="form-input" value={dealerId || ''} onChange={(e) => setSelectedDealerId(e.target.value)}>
                    {players.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
            </div>
            <div className="space-y-4">
                {players.filter(p => p.id !== dealerId).map(player => (
                    <PlayerHand key={player.id} player={player} roundData={roundData} setRoundData={setRoundData} />
                ))}
            </div>
            <div className="mt-6">
                <button onClick={onRecordRound} className="btn btn-success w-full">Record Round</button>
            </div>
        </div>
    );
};

const PlayerHand = ({ player, roundData, setRoundData }) => {
    const playerRoundData = roundData[player.id];
    if (!playerRoundData) return null;

    const updateHand = (handIndex, newHandData) => {
        const newHands = [...playerRoundData.hands];
        newHands[handIndex] = { ...newHands[handIndex], ...newHandData };
        setRoundData({ ...roundData, [player.id]: { ...playerRoundData, hands: newHands } });
    };
    
    const handleDouble = (handIndex) => {
        const hand = playerRoundData.hands[handIndex];
        if (hand.originalBet) {
            updateHand(handIndex, { bet: hand.originalBet, originalBet: null });
        } else {
            updateHand(handIndex, { bet: hand.bet * 2, originalBet: hand.bet });
        }
    };

    const handleSplit = () => {
        if (playerRoundData.hands.length > 1) return;
        const newHands = [...playerRoundData.hands, { ...playerRoundData.hands[0] }];
        setRoundData({ ...roundData, [player.id]: { ...playerRoundData, hands: newHands } });
    };

    return playerRoundData.hands.map((hand, handIndex) => (
        <div key={handIndex} className="player-hand-card">
            <div className="flex justify-between items-center mb-2">
                <p className="font-semibold text-lg text-green-400">{player.name} {playerRoundData.hands.length > 1 ? `(Hand ${handIndex + 1})` : ''}</p>
                <div className="flex items-center gap-2">
                    <label className="text-sm">Bet:</label>
                    <input type="number" className="form-input w-24 !p-1.5 text-center" value={hand.bet} onChange={(e) => updateHand(handIndex, { bet: parseFloat(e.target.value) || 0, originalBet: null })} />
                </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {['win', 'lose', 'push', 'blackjack'].map(outcome => (
                    <button key={outcome} onClick={() => updateHand(handIndex, { outcome })} className={`btn ${hand.outcome === outcome ? 'btn-primary' : 'btn-secondary'} w-full`}>{outcome.charAt(0).toUpperCase() + outcome.slice(1)}</button>
                ))}
            </div>
            <div className="grid grid-cols-2 gap-2 mt-2">
                <button onClick={() => handleDouble(handIndex)} className={`btn btn-secondary w-full ${hand.originalBet ? 'btn-primary' : ''}`}>Double</button>
                <button onClick={handleSplit} className="btn btn-secondary w-full" disabled={playerRoundData.hands.length > 1}>Split</button>
            </div>
        </div>
    ));
};


const PlayerStandings = ({ players, onEndSession, onOpenModal }) => {
    const sortedPlayers = useMemo(() => [...players].sort((a, b) => b.balance - a.balance), [players]);
    return (
        <div className="card">
            <h2 className="section-title">Player Standings</h2>
            <div className="space-y-2">
                {sortedPlayers.map(p => (
                    <div key={p.id} className="player-item">
                        <span>{p.name}</span>
                        <div className="flex items-center gap-4">
                            <button onClick={() => onOpenModal('history', { playerId: p.id })} className="text-sm text-blue-400 hover:underline">History</button>
                            <span className={`font-bold text-xl w-24 text-right ${p.balance > 0 ? 'text-green-400' : p.balance < 0 ? 'text-red-400' : 'text-gray-400'}`}>{p.balance.toFixed(2)}</span>
                        </div>
                    </div>
                ))}
            </div>
            <div className="mt-6">
                <button onClick={onEndSession} className="btn btn-danger w-full">End Session & Settle Up</button>
            </div>
        </div>
    );
};

const SettlementView = ({ session, onBackToGame, onMainMenu, onOpenModal }) => {
    const transactions = useMemo(() => {
        if (!session?.players) return [];
        let debtors = session.players.filter(p => p.balance < 0).map(p => ({ ...p, balance: -p.balance }));
        let creditors = session.players.filter(p => p.balance > 0).map(p => ({ ...p }));
        let trans = [];
        while (debtors.length > 0 && creditors.length > 0) {
            const debtor = debtors[0];
            const creditor = creditors[0];
            const amount = Math.min(debtor.balance, creditor.balance);
            trans.push({ from: debtor.name, to: creditor.name, amount, toPromptPay: creditor.promptPayId });
            debtor.balance -= amount;
            creditor.balance -= amount;
            if (debtor.balance < 0.01) debtors.shift();
            if (creditor.balance < 0.01) creditors.shift();
        }
        return trans;
    }, [session.players]);

    return (
        <div className="card">
            <h2 className="section-title">Final Settlement</h2>
            <div className="space-y-3 mb-6">
                {transactions.length > 0 ? transactions.map((t, i) => (
                    <div key={i} className="settlement-item">
                        <p><span>{t.from}</span> owes <span>{t.to}</span> <span>{t.amount.toFixed(2)}</span></p>
                        {t.toPromptPay && <button onClick={() => onOpenModal('show-qr', { phone: t.toPromptPay, amount: t.amount, to: t.to })} className="btn btn-primary">QR</button>}
                    </div>
                )) : <p>Everyone is even!</p>}
            </div>
             <div className="flex gap-4 mt-6">
                <button onClick={onBackToGame} className="btn btn-secondary flex-1">Back to Game</button>
                <button onClick={onMainMenu} className="btn btn-primary flex-1">Main Menu</button>
            </div>
        </div>
    );
};

const LandscapeView = ({ session, roundData, setRoundData, landscapeState, setLandscapeState, onRecordRound }) => {
    const { players, dealerId } = session;
    const nonDealers = players.filter(p => p.id !== dealerId);
    if (nonDealers.length === 0) return null;

    const activePlayer = nonDealers[landscapeState.activePlayerIndex];
    if (!activePlayer) return null;
    
    const playerRoundData = roundData[activePlayer.id];
    if (!playerRoundData) return null;

    const activeHand = playerRoundData.hands[landscapeState.activeHandIndex];

    const updateHand = (handIndex, newHandData) => {
        const newHands = [...playerRoundData.hands];
        newHands[handIndex] = { ...newHands[handIndex], ...newHandData };
        setRoundData({ ...roundData, [activePlayer.id]: { ...playerRoundData, hands: newHands } });
    };

    const handleDouble = () => {
        const hand = activeHand;
        if (hand.originalBet) {
            updateHand(landscapeState.activeHandIndex, { bet: hand.originalBet, originalBet: null });
        } else {
            updateHand(landscapeState.activeHandIndex, { bet: hand.bet * 2, originalBet: hand.bet });
        }
    };
    
    const handleSplit = () => {
        if (playerRoundData.hands.length > 1) return;
        const newHands = [...playerRoundData.hands, { ...playerRoundData.hands[0] }];
        setRoundData({ ...roundData, [activePlayer.id]: { ...playerRoundData, hands: newHands } });
    };

    const handleNav = (direction) => {
        let newIndex = landscapeState.activePlayerIndex + direction;
        if (newIndex >= nonDealers.length) newIndex = 0;
        if (newIndex < 0) newIndex = nonDealers.length - 1;
        setLandscapeState({ activePlayerIndex: newIndex, activeHandIndex: 0 });
    };
    
    const handleHandNav = (newHandIndex) => {
        setLandscapeState({ ...landscapeState, activeHandIndex: newHandIndex });
    };

    return (
        <div className="landscape-container">
            <div className="landscape-player-tabs">
                {nonDealers.map((p, index) => (
                    <button key={p.id} onClick={() => setLandscapeState({ activePlayerIndex: index, activeHandIndex: 0 })} className={`player-tab ${index === landscapeState.activePlayerIndex ? 'active' : ''}`}>
                        {p.name}
                    </button>
                ))}
            </div>
            <div className="landscape-header">
                <h3>{activePlayer.name} {playerRoundData.hands.length > 1 ? `(Hand ${landscapeState.activeHandIndex + 1})` : ''}</h3>
            </div>
            {playerRoundData.hands.length > 1 && (
                 <div className="hand-nav">
                    {playerRoundData.hands.map((_, index) => (
                        <button key={index} onClick={() => handleHandNav(index)} className={`btn ${index === landscapeState.activeHandIndex ? 'btn-primary' : 'btn-secondary'}`}>
                            Hand {index + 1}
                        </button>
                    ))}
                </div>
            )}
            <div className="landscape-actions">
                <button onClick={() => updateHand(landscapeState.activeHandIndex, { outcome: 'win' })} className={`btn ${activeHand.outcome === 'win' ? 'btn-primary' : 'btn-secondary'}`}>Win</button>
                <button onClick={() => updateHand(landscapeState.activeHandIndex, { outcome: 'lose' })} className={`btn ${activeHand.outcome === 'lose' ? 'btn-primary' : 'btn-secondary'}`}>Lose</button>
                <button onClick={() => updateHand(landscapeState.activeHandIndex, { outcome: 'push' })} className={`btn ${activeHand.outcome === 'push' ? 'btn-primary' : 'btn-secondary'}`}>Push</button>
                <button onClick={() => updateHand(landscapeState.activeHandIndex, { outcome: 'blackjack' })} className={`btn ${activeHand.outcome === 'blackjack' ? 'btn-primary' : 'btn-secondary'}`}>Blackjack</button>
                <button onClick={handleDouble} className={`btn ${activeHand.originalBet ? 'btn-primary' : 'btn-secondary'}`}>Double</button>
                <button onClick={handleSplit} className="btn btn-secondary" disabled={playerRoundData.hands.length > 1}>Split</button>
            </div>
            <div className="landscape-footer">
                <button onClick={() => handleNav(-1)} className="btn btn-secondary">Prev Player</button>
                <button onClick={onRecordRound} className="btn btn-success">Record Round</button>
                <button onClick={() => handleNav(1)} className="btn btn-secondary">Next Player</button>
            </div>
        </div>
    );
};

const Modal = ({ modal, closeModal, session, onUpdateSession, favoritePlayers, onUpdateFavorites }) => {
    if (!modal.isOpen) return null;

    const handleSavePlayer = async () => {
        const { playerId } = modal.data;
        const newPromptPay = document.getElementById('edit-player-promptpay').value.trim();
        const isFavorite = document.getElementById('favorite-checkbox').checked;
        
        const player = session.players.find(p => p.id === playerId);
        const updatedPlayers = session.players.map(p => p.id === playerId ? { ...p, promptPayId: newPromptPay } : p);
        
        const playerRef = doc(db, `artifacts/${appId}/public/data/blackjack_players`, player.name);
        await setDoc(playerRef, { name: player.name, promptPayId: newPromptPay, isFavorite: isFavorite }, { merge: true });
        
        onUpdateSession({ ...session, players: updatedPlayers });
        onUpdateFavorites();
        closeModal();
    };

    let title = '', content = null;
    switch (modal.type) {
        case 'edit-player':
            const player = session.players.find(p => p.id === modal.data.playerId);
            const fav = favoritePlayers.find(f => f.name === player.name);
            title = `Edit ${player.name}`;
            content = (
                <div className="space-y-4">
                    <input id="edit-player-promptpay" defaultValue={player.promptPayId || ''} className="form-input" placeholder="PromptPay ID" />
                    <div className="flex items-center">
                        <input id="favorite-checkbox" type="checkbox" defaultChecked={fav?.isFavorite} className="h-4 w-4" />
                        <label htmlFor="favorite-checkbox" className="ml-2">Add to Quick Add list</label>
                    </div>
                    <button onClick={handleSavePlayer} className="btn btn-primary w-full">Save</button>
                </div>
            );
            break;
        case 'history':
            const p = session.players.find(p => p.id === modal.data.playerId);
            title = `${p.name}'s History`;
            const historyLogs = (session?.transactionLog || []).filter(log => log.details && log.details.some(d => d.playerId === p.id));
            content = `<div class="max-h-96 overflow-y-auto space-y-2 pr-2">${historyLogs.length > 0 ? [...historyLogs].reverse().map(log => { const playerDetail = log.details.find(d => d.playerId === p.id); if (!playerDetail || typeof playerDetail.amount !== 'number') return ''; const amountColor = playerDetail.amount > 0 ? 'text-green-400' : 'text-red-400'; return `<div class="bg-gray-700 p-2 rounded-md flex justify-between items-center"><div><p class="font-medium">${playerDetail.description}</p><p class="text-xs text-gray-400">${new Date(log.timestamp).toLocaleTimeString()}</p></div><p class="font-bold ${amountColor}">${playerDetail.amount > 0 ? '+' : ''}${playerDetail.amount.toFixed(2)}</p></div>`; }).join('') : '<p class="text-gray-400">No transactions yet.</p>'}</div>`;
            break;
        case 'show-qr':
            const promptPayQrUrl = `https://promptpay.io/${modal.data.phone}/${parseFloat(modal.data.amount).toFixed(2)}.png`;
            title = `Payment for ${modal.data.to}`;
            content = `<div class="text-center"><img src="${promptPayQrUrl}" alt="QR Code" class="mx-auto rounded-lg" /><p class="mt-2 font-bold">${parseFloat(modal.data.amount).toFixed(2)} THB</p></div>`;
            break;
    }

    return (
        <div className="modal-overlay" onClick={closeModal}>
            <div className="modal-content card" onClick={e => e.stopPropagation()}>
                <div className="flex justify-between items-center mb-4">
                    <h3 className="text-xl font-semibold">{title}</h3>
                    <button onClick={closeModal} className="btn btn-secondary !p-2">X</button>
                </div>
                {content}
            </div>
        </div>
    );
};
