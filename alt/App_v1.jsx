import React, { useState, useEffect, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged, signInWithCustomToken } from 'firebase/auth';
import { getFirestore, doc, setDoc, getDoc, collection, onSnapshot, updateDoc } from 'firebase/firestore';

// --- Firebase Init ---
const firebaseConfig = {
  apiKey: "AIzaSyBQhur5ci5KJSodIsglFZX3e8EmaOG_nu8",
  authDomain: "oh-hell-card-game.firebaseapp.com",
  projectId: "oh-hell-card-game",
  storageBucket: "oh-hell-card-game.firebasestorage.app",
  messagingSenderId: "629825480306",
  appId: "1:629825480306:web:3529900886ee2dc755c4eb",
  measurementId: "G-CHEM1S110Q"
};
const appId = typeof __app_id !== 'undefined' ? __app_id : 'fahrt-zur-hoelle';

let app, auth, db;
if (firebaseConfig) {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
}

// --- Hilfsfunktionen und Spieldaten ---
const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'J', 'Q', 'K', '10', 'A'];
const CARDS_PER_ROUND = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 
  13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1
];

const createDeck = () => {
  let deck = [];
  for (let suit of SUITS) {
    for (let i = 0; i < RANKS.length; i++) {
      deck.push({
        id: `${suit}-${RANKS[i]}`,
        suit: suit,
        rank: RANKS[i],
        rankValue: i + 2, 
        isJoker: false,
      });
    }
  }
  deck.push({ id: 'joker_1', suit: 'none', rank: 'Joker', rankValue: 15, isJoker: true });
  deck.push({ id: 'joker_2', suit: 'none', rank: 'Joker', rankValue: 15, isJoker: true });
  
  // Mischen
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
};

const isTrumpCard = (card, trumpSuit) => {
  return card.isJoker || (trumpSuit && card.suit === trumpSuit);
};

const getValidCards = (hand, trick, trumpSuit) => {
  if (trick.length === 0) return hand; 

  const ledCard = trick[0].card;
  const isTrumpLed = isTrumpCard(ledCard, trumpSuit);
  const ledSuit = isTrumpLed ? trumpSuit : ledCard.suit;
  const hasTrump = hand.some(c => isTrumpCard(c, trumpSuit));

  if (isTrumpLed) {
    if (hasTrump) {
      const trumpsInHand = hand.filter(c => isTrumpCard(c, trumpSuit));
      let highestTrumpValue = -1;
      trick.forEach((t) => {
        if (isTrumpCard(t.card, trumpSuit)) {
          let val = t.card.isJoker ? 100 : t.card.rankValue;
          if (t.card.isJoker && trick.findIndex(x => x.card.isJoker) === trick.indexOf(t)) val = 101;
          if (val > highestTrumpValue) highestTrumpValue = val;
        }
      });
      const higherTrumps = trumpsInHand.filter(c => (c.isJoker ? 100 : c.rankValue) > highestTrumpValue);
      return higherTrumps.length > 0 ? higherTrumps : trumpsInHand;
    } else {
      return hand; 
    }
  }

  const hasLedSuit = hand.some(c => !c.isJoker && c.suit === ledSuit);
  if (hasLedSuit) {
    return hand.filter(c => !c.isJoker && c.suit === ledSuit); 
  } else {
    if (hasTrump) {
      return hand.filter(c => isTrumpCard(c, trumpSuit));
    } else {
      return hand; 
    }
  }
};

const determineWinner = (trick, trumpSuit) => {
  const ledCard = trick[0].card;
  const isTrumpLed = isTrumpCard(ledCard, trumpSuit);
  const ledSuit = isTrumpLed ? trumpSuit : ledCard.suit;

  let winnerPlayerIndex = trick[0].playerIndex;
  let highestValue = -1;

  trick.forEach((t, index) => {
    let value = 0;
    if (t.card.isJoker) {
      const isFirstJoker = trick.findIndex(x => x.card.isJoker) === index;
      value = isFirstJoker ? 101 : 100;
    } else if (isTrumpCard(t.card, trumpSuit)) {
      value = 50 + t.card.rankValue;
    } else if (!isTrumpLed && t.card.suit === ledSuit) {
      value = t.card.rankValue;
    } else {
      value = 0; 
    }

    if (value > highestValue) {
      highestValue = value;
      winnerPlayerIndex = t.playerIndex;
    }
  });

  return winnerPlayerIndex;
};

const getSuitSymbol = (suit) => {
  switch (suit) {
    case 'hearts': return '♥';
    case 'diamonds': return '♦';
    case 'clubs': return '♣';
    case 'spades': return '♠';
    default: return '';
  }
};

const generateRoundState = (rIndex, dealerIndex) => {
  const deck = createDeck();
  const numCards = CARDS_PER_ROUND[rIndex];
  const newHands = [[], [], [], []];
  
  for (let i = 0; i < 4; i++) {
    for (let c = 0; c < numCards; c++) {
      newHands[i].push(deck.pop());
    }
    newHands[i].sort((a, b) => a.suit.localeCompare(b.suit) || a.rankValue - b.rankValue);
  }

  let trump = null;
  if (deck.length > 0) {
    trump = deck.pop();
    if (trump.isJoker && deck.length > 0) {
      trump = deck.pop();
      if (trump.isJoker) trump = null;
    }
  }

  const startPlayer = (dealerIndex + 1) % 4;

  return {
    roundIndex: rIndex,
    phase: 'bidding',
    dealer: dealerIndex,
    currentPlayer: startPlayer,
    trickLeader: startPlayer,
    hands: newHands,
    trick: [],
    bids: [null, null, null, null],
    tricksWon: [0, 0, 0, 0],
    scores: [0, 0, 0, 0], // Startet bei 0, wird aus history geladen falls Runde > 0
    scoreHistory: [],
    trumpCard: trump,
    message: `Runde ${rIndex + 1}: Ansagen!`,
    lastWinner: null
  };
};


// --- React Komponente ---
export default function App() {
  const [user, setUser] = useState(null);
  const [userName, setUserName] = useState('');
  const [roomCodeInput, setRoomCodeInput] = useState('');
  const [currentRoomId, setCurrentRoomId] = useState(null);
  const [roomData, setRoomData] = useState(null);
  const [showScoreboard, setShowScoreboard] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const timerRef = useRef(null);

  // --- 1. Firebase Auth ---
  useEffect(() => {
    if (!auth) return;
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (err) {
        console.error("Auth error", err);
      }
    };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, []);

  // --- 2. Firestore Sync ---
  useEffect(() => {
    if (!user || !currentRoomId || !db) return;
    
    const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'rooms', currentRoomId);
    const unsubscribe = onSnapshot(roomRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        // Parse the serialized gameState to avoid nested array issues
        if (data.gameState && typeof data.gameState === 'string') {
          data.gameState = JSON.parse(data.gameState);
        }
        setRoomData(data);
      } else {
        setErrorMsg("Raum existiert nicht mehr.");
        setCurrentRoomId(null);
      }
    }, (err) => {
      console.error(err);
      setErrorMsg("Verbindungsfehler");
    });

    return () => unsubscribe();
  }, [user, currentRoomId]);


  // --- 3. Bot & Game Loop Logic (Only Host runs this) ---
  useEffect(() => {
    if (!roomData || !user || roomData.hostUid !== user.uid) return;
    
    const gs = roomData.gameState;
    if (!gs || roomData.status !== 'playing') return;

    clearTimeout(timerRef.current);

    const isCurrentPlayerBot = roomData.players.find(p => p.seat === gs.currentPlayer)?.isBot;

    if (gs.phase === 'bidding' && isCurrentPlayerBot) {
      timerRef.current = setTimeout(() => {
        const handSize = gs.hands[gs.currentPlayer].length;
        const randomBid = Math.floor(Math.random() * (handSize / 3 + 1));
        executeBid(gs.currentPlayer, randomBid);
      }, 1500);
    } 
    else if (gs.phase === 'playing' && isCurrentPlayerBot) {
      timerRef.current = setTimeout(() => {
        const validCards = getValidCards(gs.hands[gs.currentPlayer], gs.trick, gs.trumpCard?.suit);
        const cardToPlay = validCards[Math.floor(Math.random() * validCards.length)];
        executePlayCard(gs.currentPlayer, cardToPlay);
      }, 2000);
    }
    else if (gs.phase === 'trick_end') {
      timerRef.current = setTimeout(() => {
        executeResolveTrick();
      }, 2500);
    }
    else if (gs.phase === 'round_end') {
      timerRef.current = setTimeout(() => {
        executeStartRound(gs.roundIndex + 1, gs.scores, gs.scoreHistory);
      }, 5000);
    }

    return () => clearTimeout(timerRef.current);
  }, [roomData?.gameState?.phase, roomData?.gameState?.currentPlayer, roomData?.gameState?.trick?.length, user]);


  // --- Lobby Actions ---
  const generateRoomCode = () => Math.random().toString(36).substring(2, 6).toUpperCase();

  const handleCreateRoom = async () => {
    if (!userName.trim()) { setErrorMsg("Bitte Namen eingeben"); return; }
    const newRoomId = generateRoomCode();
    const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'rooms', newRoomId);
    
    await setDoc(roomRef, {
      id: newRoomId,
      hostUid: user.uid,
      status: 'waiting', // waiting, playing, finished
      players: [{ uid: user.uid, name: userName, isBot: false, seat: null }],
      gameState: null
    });
    
    setCurrentRoomId(newRoomId);
    setErrorMsg('');
  };

  const handleJoinRoom = async () => {
    if (!userName.trim()) { setErrorMsg("Bitte Namen eingeben"); return; }
    if (!roomCodeInput.trim()) { setErrorMsg("Bitte Code eingeben"); return; }
    
    const code = roomCodeInput.trim().toUpperCase();
    const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'rooms', code);
    const docSnap = await getDoc(roomRef);
    
    if (docSnap.exists()) {
      const data = docSnap.data();
      if (data.status !== 'waiting') {
        setErrorMsg("Spiel läuft bereits.");
        return;
      }
      if (data.players.length >= 4) {
        setErrorMsg("Raum ist voll.");
        return;
      }
      if (data.players.some(p => p.uid === user.uid)) {
        setCurrentRoomId(code); // Already inside
        return;
      }
      
      const newPlayers = [...data.players, { uid: user.uid, name: userName, isBot: false, seat: null }];
      await updateDoc(roomRef, { players: newPlayers });
      setCurrentRoomId(code);
      setErrorMsg('');
    } else {
      setErrorMsg("Raum nicht gefunden.");
    }
  };

  const handleStartGame = async () => {
    if (roomData.hostUid !== user.uid) return;
    
    let finalPlayers = [...roomData.players];
    let botCount = 1;
    // Fill with bots
    while (finalPlayers.length < 4) {
      finalPlayers.push({ uid: `bot-${Date.now()}-${botCount}`, name: `Bot ${botCount}`, isBot: true, seat: null });
      botCount++;
    }

    // Assign random seats 0-3
    const seats = [0, 1, 2, 3].sort(() => Math.random() - 0.5);
    finalPlayers.forEach((p, i) => p.seat = seats[i]);
    // Sort array by seat exactly
    finalPlayers.sort((a, b) => a.seat - b.seat);

    const initialGs = generateRoundState(0, 3);

    const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'rooms', currentRoomId);
    await updateDoc(roomRef, {
      status: 'playing',
      players: finalPlayers,
      gameState: JSON.stringify(initialGs) // Serialize nested arrays
    });
  };


  // --- Game Actions (Firestore Updates) ---
  const updateGameState = async (newGsModifications) => {
    const gs = JSON.parse(JSON.stringify(roomData.gameState)); // Deep copy
    Object.assign(gs, newGsModifications);
    const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'rooms', currentRoomId);
    await updateDoc(roomRef, { gameState: JSON.stringify(gs) });
  };

  const executeStartRound = async (rIndex, oldScores, oldHistory) => {
    if (rIndex >= CARDS_PER_ROUND.length) {
      const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'rooms', currentRoomId);
      await updateDoc(roomRef, { status: 'finished' });
      return;
    }
    const dealerIndex = roomData.gameState.dealer;
    const nextDealer = (dealerIndex + 1) % 4;
    const newGs = generateRoundState(rIndex, nextDealer);
    newGs.scores = oldScores;
    newGs.scoreHistory = oldHistory;
    
    const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'rooms', currentRoomId);
    await updateDoc(roomRef, { gameState: JSON.stringify(newGs) });
  };

  const executeBid = async (playerIndex, bid) => {
    const gs = JSON.parse(JSON.stringify(roomData.gameState));
    gs.bids[playerIndex] = bid;
    
    let nextPlayer = (gs.currentPlayer + 1) % 4;
    if (nextPlayer === gs.trickLeader) {
      gs.phase = 'playing';
      gs.message = 'Spielphase beginnt!';
    } else {
      const nextName = roomData.players[nextPlayer].name;
      gs.message = `${nextName} sagt an.`;
    }
    gs.currentPlayer = nextPlayer;
    
    const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'rooms', currentRoomId);
    await updateDoc(roomRef, { gameState: JSON.stringify(gs) });
  };

  const executePlayCard = async (playerIndex, card) => {
    const gs = JSON.parse(JSON.stringify(roomData.gameState));
    gs.hands[playerIndex] = gs.hands[playerIndex].filter(c => c.id !== card.id);
    gs.trick.push({ playerIndex, card });
    
    if (gs.trick.length === 4) {
      gs.phase = 'trick_end';
      gs.currentPlayer = null;
    } else {
      gs.currentPlayer = (gs.currentPlayer + 1) % 4;
      gs.message = `${roomData.players[gs.currentPlayer].name} spielt...`;
    }

    const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'rooms', currentRoomId);
    await updateDoc(roomRef, { gameState: JSON.stringify(gs) });
  };

  const executeResolveTrick = async () => {
    const gs = JSON.parse(JSON.stringify(roomData.gameState));
    const winner = determineWinner(gs.trick, gs.trumpCard?.suit);
    gs.tricksWon[winner] += 1;
    
    const handsEmpty = gs.hands[0].length === 0; // Check any hand

    if (handsEmpty) {
      for (let i = 0; i < 4; i++) {
        const bid = gs.bids[i];
        const won = gs.tricksWon[i];
        if (bid === 0) {
          gs.scores[i] += won === 0 ? 10 : -(won * 10);
        } else {
          gs.scores[i] += won >= bid ? (bid * 10) + (won - bid) : -(bid * 10);
        }
      }
      
      gs.scoreHistory.push({
        roundIndex: gs.roundIndex,
        cards: CARDS_PER_ROUND[gs.roundIndex],
        bids: [...gs.bids],
        won: [...gs.tricksWon],
        scores: [...gs.scores]
      });

      gs.phase = 'round_end';
      gs.trick = [];
      gs.message = `Runde beendet! ${roomData.players[winner].name} holt den letzten Stich.`;
      gs.lastWinner = winner;
    } else {
      gs.phase = 'playing';
      gs.trick = [];
      gs.currentPlayer = winner;
      gs.trickLeader = winner;
      gs.message = `${roomData.players[winner].name} macht den Stich und ist dran.`;
      gs.lastWinner = winner;
    }

    const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'rooms', currentRoomId);
    await updateDoc(roomRef, { gameState: JSON.stringify(gs) });
  };

  // --- Render Helpers ---
  const renderCard = (card, isPlayable = false, onClick = null) => {
    if (!card) return null;
    const isRed = card.suit === 'hearts' || card.suit === 'diamonds';
    const suitSymbol = getSuitSymbol(card.suit);
    
    return (
      <div 
        onClick={() => isPlayable && onClick && onClick(card)}
        className={`w-12 h-16 sm:w-20 sm:h-28 bg-white rounded-lg shadow-md border border-slate-300 flex flex-col justify-between p-1 sm:p-2 select-none 
          ${isPlayable ? 'cursor-pointer hover:-translate-y-2 hover:shadow-lg transition-transform' : 'opacity-90'}
          ${card.isJoker ? 'text-purple-600' : isRed ? 'text-red-600' : 'text-slate-800'}`}
      >
        <div className="text-[10px] sm:text-sm font-bold">{card.rank}</div>
        <div className="text-xl sm:text-4xl text-center self-center">{card.isJoker ? '🃏' : suitSymbol}</div>
        <div className="text-[10px] sm:text-sm font-bold text-right rotate-180">{card.rank}</div>
      </div>
    );
  };

  const renderCardBack = () => (
    <div className="w-8 h-12 sm:w-14 sm:h-20 bg-blue-800 rounded shadow-md border-2 border-white flex items-center justify-center -ml-4 sm:-ml-6 first:ml-0">
      <div className="w-full h-full border border-blue-400 opacity-50 m-0.5 sm:m-1 rounded-sm flex items-center justify-center">
        <span className="text-white text-opacity-50 text-[8px] sm:text-xs">FzH</span>
      </div>
    </div>
  );

  // === RENDER ===
  if (!user || !db) return <div className="min-h-screen bg-slate-900 flex items-center justify-center text-white">Verbinde...</div>;

  // LOBBY VIEW
  if (!currentRoomId || !roomData) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
        <div className="bg-slate-800 p-8 rounded-2xl shadow-2xl text-center max-w-md w-full border border-slate-700">
          <h1 className="text-4xl font-bold text-red-500 mb-2">Oh Hell</h1>
          <p className="text-slate-400 mb-8">Multiplayer Edition</p>
          
          {errorMsg && <div className="bg-red-900/50 text-red-200 p-3 rounded mb-4 text-sm">{errorMsg}</div>}

          <div className="space-y-4 text-left">
            <div>
              <label className="block text-slate-300 text-sm mb-1 font-bold">Dein Name</label>
              <input 
                value={userName} onChange={e => setUserName(e.target.value)}
                maxLength={12}
                className="w-full bg-slate-900 border border-slate-600 text-white p-3 rounded-lg focus:outline-none focus:border-green-500"
                placeholder="Spielername..."
              />
            </div>
            
            <hr className="border-slate-700 my-4"/>
            
            <button onClick={handleCreateRoom} className="w-full bg-green-600 hover:bg-green-500 text-white font-bold py-3 px-4 rounded-lg shadow-lg transition-all">
              Neuen Raum erstellen
            </button>
            
            <div className="flex items-center space-x-2 pt-4">
              <input 
                value={roomCodeInput} onChange={e => setRoomCodeInput(e.target.value.toUpperCase())}
                maxLength={4}
                className="w-2/3 bg-slate-900 border border-slate-600 text-white p-3 rounded-lg focus:outline-none focus:border-blue-500 uppercase text-center font-bold tracking-widest"
                placeholder="CODE"
              />
              <button onClick={handleJoinRoom} className="w-1/3 bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 px-4 rounded-lg shadow-lg transition-all">
                Beitreten
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // WAITING ROOM VIEW
  if (roomData.status === 'waiting') {
    const isHost = roomData.hostUid === user.uid;
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
        <div className="bg-slate-800 p-8 rounded-2xl shadow-2xl text-center max-w-md w-full border border-slate-700 relative overflow-hidden">
          <div className="absolute top-0 right-0 bg-yellow-500 text-slate-900 font-bold px-4 py-1 rounded-bl-lg">
            CODE: {roomData.id}
          </div>
          <h2 className="text-2xl font-bold text-white mb-6 mt-4">Warteraum</h2>
          
          <div className="bg-slate-900/50 rounded-lg p-4 mb-6 space-y-2 text-left">
            {roomData.players.map((p, i) => (
              <div key={i} className="flex justify-between items-center text-slate-300 border-b border-slate-700 pb-2 last:border-0">
                <span className="font-bold flex items-center">
                   {p.name} {p.uid === user.uid && <span className="ml-2 text-xs bg-green-800 px-2 py-0.5 rounded text-white">Du</span>}
                </span>
                {p.uid === roomData.hostUid && <span className="text-yellow-400 text-xs uppercase tracking-wider">Host</span>}
              </div>
            ))}
            {roomData.players.length < 4 && (
              <div className="text-slate-500 text-sm italic pt-2 text-center animate-pulse">
                Warte auf weitere Spieler ({roomData.players.length}/4)...
              </div>
            )}
          </div>

          {isHost ? (
            <button 
              onClick={handleStartGame}
              className="w-full bg-green-600 hover:bg-green-500 text-white font-bold py-3 px-8 rounded-lg shadow-lg transition-all"
            >
              Spiel starten (mit {4 - roomData.players.length} Bots auffüllen)
            </button>
          ) : (
            <div className="text-slate-400 text-sm">Warte auf Host, um das Spiel zu starten...</div>
          )}
        </div>
      </div>
    );
  }

  // GAME VIEW
  const gs = roomData.gameState;
  if (!gs) return null;

  // Determine current user's seat (or observer if somehow not in list)
  const myPlayer = roomData.players.find(p => p.uid === user.uid);
  const mySeat = myPlayer ? myPlayer.seat : 0;
  
  // UI Rotation mapping
  const posBottom = mySeat;
  const posLeft = (mySeat + 1) % 4;
  const posTop = (mySeat + 2) % 4;
  const posRight = (mySeat + 3) % 4;

  const validPlayerCards = gs.phase === 'playing' && gs.currentPlayer === mySeat 
    ? getValidCards(gs.hands[mySeat], gs.trick, gs.trumpCard?.suit) 
    : [];

  const getPlayerLabel = (seatIdx) => {
    const p = roomData.players.find(x => x.seat === seatIdx);
    if (!p) return `Sitz ${seatIdx}`;
    return p.uid === user.uid ? 'Du' : p.name;
  };

  const getOpponentUI = (seatIdx, alignClass) => {
    const p = roomData.players.find(x => x.seat === seatIdx);
    if (!p) return null;
    return (
      <div className={`absolute ${alignClass} flex flex-col items-center`}>
        <div className="bg-black/60 px-3 py-1 rounded-full text-xs sm:text-sm mb-2 text-center flex items-center space-x-3 backdrop-blur-sm border border-slate-700">
          <span className={`font-bold ${p.isBot ? 'text-slate-400' : 'text-blue-300'}`}>{p.name}</span>
          <span className="text-slate-300">Pkt: {gs.scores[seatIdx]}</span>
          <span className="bg-slate-800 px-2 rounded font-mono">
            {gs.tricksWon[seatIdx]} / {gs.bids[seatIdx] !== null ? gs.bids[seatIdx] : '?'}
          </span>
        </div>
        <div className="flex">
          {gs.hands[seatIdx].map((_, i) => <React.Fragment key={i}>{renderCardBack()}</React.Fragment>)}
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-green-900 text-white font-sans flex flex-col overflow-hidden relative selection:bg-transparent">
      
      {/* Top Bar */}
      <div className="bg-slate-900/80 p-2 sm:p-4 flex justify-between items-center shadow-md z-10 backdrop-blur-md">
        <div>
          <h1 className="text-lg sm:text-2xl font-bold text-yellow-400 drop-shadow-md">Oh Hell</h1>
          <div className="text-xs sm:text-sm text-slate-300">
            Runde {gs.roundIndex + 1} / 26 &nbsp;|&nbsp; {CARDS_PER_ROUND[gs.roundIndex]} Karte(n) &nbsp;|&nbsp; Raum: {roomData.id}
          </div>
        </div>
        
        <div className="flex items-center space-x-2 sm:space-x-4">
          <button
            onClick={() => setShowRules(true)}
            className="bg-purple-600 hover:bg-purple-500 text-white px-2 py-1 sm:px-3 sm:py-1 rounded text-xs sm:text-sm font-bold shadow transition-colors"
          >
            📖 Regeln
          </button>
          <button
            onClick={() => setShowScoreboard(true)}
            className="bg-blue-600 hover:bg-blue-500 text-white px-2 py-1 sm:px-3 sm:py-1 rounded text-xs sm:text-sm font-bold shadow transition-colors"
          >
            📊 Tabelle
          </button>
          <div className="text-right">
            <span className="text-xs text-slate-400 block uppercase tracking-wider">Trumpf</span>
            <div className="flex items-center bg-white/10 px-2 py-1 rounded">
              {gs.trumpCard ? (
                 <span className={`text-base sm:text-xl font-bold ${gs.trumpCard.isJoker ? 'text-purple-400' : (gs.trumpCard.suit === 'hearts' || gs.trumpCard.suit === 'diamonds' ? 'text-red-400' : 'text-slate-300')}`}>
                   {gs.trumpCard.isJoker ? '🃏 Joker' : `${getSuitSymbol(gs.trumpCard.suit)} ${gs.trumpCard.rank}`}
                 </span>
              ) : (
                <span className="text-slate-300 font-bold">Keiner</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Main Table Area */}
      <div className="flex-1 relative flex items-center justify-center p-4">
        
        {getOpponentUI(posTop, "top-4 left-1/2 -translate-x-1/2")}
        {getOpponentUI(posLeft, "left-0 sm:left-4 top-1/2 -translate-y-1/2 -rotate-90 origin-center -translate-x-1/4 sm:translate-x-0")}
        {getOpponentUI(posRight, "right-0 sm:right-4 top-1/2 -translate-y-1/2 rotate-90 origin-center translate-x-1/4 sm:translate-x-0")}

        {/* Center Trick Area */}
        <div className="w-64 h-64 sm:w-80 sm:h-80 bg-green-800/40 rounded-full border-4 border-green-700/50 flex items-center justify-center relative shadow-inner">
          {gs.trick.map((t) => {
             let posClass = "";
             if (t.playerIndex === posBottom) posClass = "bottom-4 left-1/2 -translate-x-1/2";
             if (t.playerIndex === posLeft) posClass = "left-4 top-1/2 -translate-y-1/2 -rotate-12";
             if (t.playerIndex === posTop) posClass = "top-4 left-1/2 -translate-x-1/2";
             if (t.playerIndex === posRight) posClass = "right-4 top-1/2 -translate-y-1/2 rotate-12";
             
             return (
               <div key={t.card.id} className={`absolute ${posClass} transition-all duration-300 drop-shadow-2xl`}>
                 {renderCard(t.card)}
               </div>
             );
          })}
          {gs.trick.length === 0 && gs.phase === 'playing' && (
             <div className="text-green-600/50 font-bold uppercase tracking-widest text-lg sm:text-xl text-center px-4">
               {gs.currentPlayer === mySeat ? "Du bist dran" : `${getPlayerLabel(gs.currentPlayer)} spielt...`}
             </div>
          )}
        </div>
      </div>

      {/* Human Player Bottom */}
      <div className="bg-slate-900/90 p-4 pb-8 shadow-[0_-10px_40px_rgba(0,0,0,0.5)] z-20">
        <div className="max-w-4xl mx-auto">
          <div className="flex justify-between items-end mb-4">
            <div className="bg-black/60 px-4 py-2 rounded-lg inline-block border border-slate-700">
              <span className="font-bold text-green-400 text-lg mr-4">{myPlayer?.name || 'Du'}</span>
              <span className="text-slate-300 mr-4">Punkte: <span className="text-white font-bold">{gs.scores[mySeat]}</span></span>
              <span className="bg-green-800/80 px-3 py-1 rounded text-white font-mono">
                Stiche: {gs.tricksWon[mySeat]} / {gs.bids[mySeat] !== null ? gs.bids[mySeat] : '?'}
              </span>
            </div>
            
            <div className="text-right text-xs sm:text-sm text-yellow-300 font-medium bg-black/40 px-3 py-1 rounded">
              {gs.message}
            </div>
          </div>

          <div className="flex justify-center gap-1 sm:gap-2 flex-wrap">
            {gs.hands[mySeat].map(card => {
              const isPlayable = gs.phase === 'playing' && gs.currentPlayer === mySeat && validPlayerCards.some(c => c.id === card.id);
              return (
                <div key={card.id}>
                  {renderCard(card, isPlayable, () => executePlayCard(mySeat, card))}
                </div>
              );
            })}
            {gs.hands[mySeat].length === 0 && (
              <div className="h-16 sm:h-28 flex items-center text-slate-500 italic text-sm">Keine Karten</div>
            )}
          </div>
        </div>
      </div>

      {/* Bidding Modal */}
      {gs.phase === 'bidding' && gs.currentPlayer === mySeat && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-md px-4">
          <div className="bg-slate-800/95 p-6 rounded-2xl shadow-2xl border border-slate-600 text-center backdrop-blur-md">
            <h2 className="text-2xl font-bold text-white mb-4">Deine Ansage</h2>
            
            {(() => {
              const biddingOrder = [];
              let curr = gs.trickLeader;
              while (curr !== mySeat) {
                if (gs.bids[curr] !== null) {
                  biddingOrder.push(curr);
                }
                curr = (curr + 1) % 4;
              }
              
              if (biddingOrder.length === 0) {
                return <p className="text-slate-400 mb-6 text-sm">Du bist als Erster dran mit Ansagen.</p>;
              }
              
              return (
                <div className="mb-6 text-sm text-slate-300 bg-slate-900/80 p-3 rounded-lg text-left shadow-inner">
                  <h3 className="font-bold mb-2 text-slate-400 border-b border-slate-700 pb-1">Bisherige Ansagen:</h3>
                  <ul className="space-y-1">
                    {biddingOrder.map(pid => (
                      <li key={pid} className="flex justify-between">
                        <span>{getPlayerLabel(pid)}</span>
                        <span className="font-bold text-yellow-400">{gs.bids[pid]} Stich(e)</span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })()}

            <p className="text-slate-300 mb-4 text-sm">Wie viele Stiche wirst du machen?</p>
            <div className="flex flex-wrap justify-center gap-2 sm:gap-3">
              {Array.from({ length: CARDS_PER_ROUND[gs.roundIndex] + 1 }).map((_, i) => (
                <button
                  key={i}
                  onClick={() => executeBid(mySeat, i)}
                  className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-green-600 hover:bg-green-500 text-white font-bold text-lg sm:text-xl shadow-lg transition-transform hover:scale-110"
                >
                  {i}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Round End Overlay */}
      {(gs.phase === 'round_end' || roomData.status === 'finished') && (
        <div className="absolute inset-0 bg-black/80 z-50 flex flex-col items-center justify-center backdrop-blur-md p-4">
          <div className="bg-slate-800 p-8 rounded-2xl shadow-2xl border border-slate-600 w-full max-w-2xl text-center">
            <h2 className="text-3xl sm:text-4xl font-bold text-yellow-400 mb-6">
              {roomData.status === 'finished' ? 'Endstand' : `Auswertung Runde ${gs.roundIndex + 1}`}
            </h2>
            
            <div className="overflow-x-auto rounded-lg border border-slate-700">
              <table className="w-full text-left border-collapse bg-slate-900/50 text-sm sm:text-base">
                <thead>
                  <tr className="border-b border-slate-600 text-slate-300 bg-slate-800/80">
                    <th className="p-3">Spieler</th>
                    <th className="p-3 text-center">Ansage</th>
                    <th className="p-3 text-center">Gemacht</th>
                    <th className="p-3 text-right">Punkte (Gesamt)</th>
                  </tr>
                </thead>
                <tbody>
                  {[0, 1, 2, 3].map(i => {
                    const seatIndex = (mySeat + i) % 4; // Render myself first
                    const p = roomData.players.find(x => x.seat === seatIndex);
                    const bid = gs.bids[seatIndex];
                    const won = gs.tricksWon[seatIndex];
                    const success = won === bid;
                    
                    return (
                      <tr key={seatIndex} className={`border-b border-slate-700/50 ${seatIndex === mySeat ? 'bg-slate-700/40' : ''}`}>
                        <td className="p-3 font-bold flex items-center space-x-2">
                           <span className={seatIndex === mySeat ? 'text-green-400' : 'text-slate-200'}>{p?.name}</span>
                        </td>
                        <td className="p-3 text-slate-300 text-center">{bid}</td>
                        <td className="p-3 text-center">
                          <span className={success ? 'text-green-400 font-bold' : 'text-red-400 font-bold'}>
                            {won}
                          </span>
                        </td>
                        <td className="p-3 font-mono text-lg font-bold text-right text-yellow-100">
                          {gs.scores[seatIndex]}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {roomData.status === 'finished' && roomData.hostUid === user.uid && (
              <button 
                onClick={() => window.location.reload()}
                className="mt-8 bg-yellow-500 hover:bg-yellow-400 text-slate-900 font-bold py-3 px-8 rounded-full shadow-lg transition-all text-xl"
              >
                Lobby verlassen
              </button>
            )}
            {gs.phase === 'round_end' && (
               <p className="mt-6 text-slate-400 animate-pulse text-sm sm:text-base">
                  {roomData.hostUid === user.uid ? "Bereite nächste Runde vor..." : "Warte auf Host für nächste Runde..."}
               </p>
            )}
          </div>
        </div>
      )}

      {/* Scoreboard Modal */}
      {showScoreboard && (
        <div className="absolute inset-0 bg-black/95 z-[60] flex flex-col items-center p-2 sm:p-8 backdrop-blur-md overflow-hidden">
          <div className="bg-slate-800 rounded-xl shadow-2xl border border-slate-600 w-full max-w-6xl flex flex-col h-full max-h-full">
            <div className="p-4 flex justify-between items-center border-b border-slate-700 shrink-0">
               <h2 className="text-xl sm:text-2xl font-bold text-white">Gesamtpunktstand</h2>
               <button onClick={() => setShowScoreboard(false)} className="text-slate-400 hover:text-white text-3xl leading-none">&times;</button>
            </div>
            <div className="p-0 sm:p-4 overflow-auto flex-1 custom-scrollbar">
              <table className="w-full text-center border-collapse text-xs sm:text-sm min-w-[600px]">
                <thead className="sticky top-0 bg-slate-900 shadow-md z-10">
                  <tr>
                    <th className="p-2 border border-slate-700 text-slate-300" rowSpan={2}>Runde (Karten)</th>
                    {[0,1,2,3].map(i => (
                      <th key={i} className={`p-2 border border-slate-700 ${i===mySeat ? 'text-green-400' : 'text-slate-300'}`} colSpan={3}>{getPlayerLabel(i)}</th>
                    ))}
                  </tr>
                  <tr>
                    {[0,1,2,3].map(i => (
                      <React.Fragment key={`sub-${i}`}>
                        <th className="p-1 border border-slate-700 text-slate-400">Ans.</th>
                        <th className="p-1 border border-slate-700 text-slate-400">Gem.</th>
                        <th className="p-1 border border-slate-700 font-bold text-yellow-400">Pkt</th>
                      </React.Fragment>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {CARDS_PER_ROUND.map((cards, rIdx) => {
                    const h = gs.scoreHistory.find(x => x.roundIndex === rIdx);
                    const isCurrent = gs.roundIndex === rIdx;
                    return (
                      <tr key={rIdx} className={`${isCurrent ? 'bg-slate-700/50 font-bold' : 'hover:bg-slate-700/30'} ${h ? 'text-white' : 'text-slate-500'}`}>
                        <td className="p-2 border border-slate-700">{rIdx + 1} ({cards})</td>
                        {[0,1,2,3].map(i => {
                           if (h) {
                             const success = h.won[i] >= h.bids[i];
                             return (
                               <React.Fragment key={`data-${rIdx}-${i}`}>
                                 <td className="p-1 border border-slate-700 bg-slate-900/30">{h.bids[i]}</td>
                                 <td className={`p-1 border border-slate-700 bg-slate-900/30 ${success ? 'text-green-400' : 'text-red-400'}`}>{h.won[i]}</td>
                                 <td className="p-1 border border-slate-700 font-mono font-bold text-yellow-200">{h.scores[i]}</td>
                               </React.Fragment>
                             )
                           } else {
                             return (
                               <React.Fragment key={`empty-${rIdx}-${i}`}>
                                 <td className="p-1 border border-slate-700 bg-slate-900/30">-</td>
                                 <td className="p-1 border border-slate-700 bg-slate-900/30">-</td>
                                 <td className="p-1 border border-slate-700">-</td>
                               </React.Fragment>
                             )
                           }
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Rules Modal */}
      {showRules && (
        <div className="absolute inset-0 bg-black/95 z-[60] flex flex-col items-center justify-center p-4 backdrop-blur-md">
          <div className="bg-slate-800 rounded-xl shadow-2xl border border-slate-600 w-full max-w-2xl flex flex-col max-h-[90vh]">
            <div className="p-4 flex justify-between items-center border-b border-slate-700 shrink-0">
               <h2 className="text-xl sm:text-2xl font-bold text-white">📖 Spielregeln</h2>
               <button onClick={() => setShowRules(false)} className="text-slate-400 hover:text-white text-3xl leading-none">&times;</button>
            </div>
            <div className="p-6 overflow-auto custom-scrollbar text-slate-300 space-y-4 text-sm sm:text-base">
              <p><strong>Ziel:</strong> Sage vor jeder Runde exakt voraus, wie viele Stiche du machen wirst.</p>
              
              <h3 className="text-yellow-400 font-bold mt-4 border-b border-slate-700 pb-1">Ablauf</h3>
              <ul className="list-disc pl-5 space-y-1">
                <li>Es werden 26 Runden gespielt (Kartenanzahl: 1 bis 13, dann 13 bis 1).</li>
                <li>Die restliche oberste Karte bestimmt die <strong>Trumpffarbe</strong>.</li>
              </ul>

              <h3 className="text-yellow-400 font-bold mt-4 border-b border-slate-700 pb-1">Ausspielen & Stechen</h3>
              <ul className="list-disc pl-5 space-y-1">
                <li><strong>Bedienpflicht:</strong> Die angespielte Farbe MUSS bedient werden.</li>
                <li>Kannst du nicht bedienen, kannst du Trumpf legen oder eine andere Karte abwerfen.</li>
                <li><strong>Überbietzwang:</strong> Wird Trumpf (oder ein Joker) angespielt, MUSST du mit einem höheren Trumpf überbieten, falls du einen hast.</li>
                <li><strong>Joker:</strong> Joker sind die höchsten Trümpfe. Liegen zwei Joker im selben Stich, gewinnt der zuerst gelegte Joker.</li>
              </ul>

              <h3 className="text-yellow-400 font-bold mt-4 border-b border-slate-700 pb-1">Punkte</h3>
              <ul className="list-disc pl-5 space-y-1">
                <li><strong>Ansage exakt getroffen:</strong> 10 Punkte + 1 Punkt pro gemachtem Stich.</li>
                <li><strong>Ansage 0 getroffen:</strong> 10 Punkte.</li>
                <li><strong>Ansage verfehlt (zu viel/zu wenig):</strong> -10 Punkte pro <em>angesagtem</em> Stich.</li>
                <li><strong>0 angesagt, aber Stiche gemacht:</strong> -10 Punkte pro <em>gemachtem</em> Stich.</li>
              </ul>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}