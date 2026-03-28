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
const appId = typeof __app_id !== 'undefined' ? __app_id : 'oh-hell-multiplayer';

let app, auth, db;
if (firebaseConfig) {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
}

// --- Hilfsfunktionen und Spieldaten ---
const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];
const ALL_RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'J', 'Q', 'K', '10', 'A'];

const getGameConfig = (numPlayers) => {
  if (numPlayers === 5) {
    return {
      maxCards: 10,
      rounds: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1],
      ranks: ALL_RANKS
    };
  } else if (numPlayers === 3) {
    return {
      maxCards: 13,
      rounds: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1],
      ranks: ['5', '6', '7', '8', '9', 'J', 'Q', 'K', '10', 'A'] // 2, 3, 4 entfernt
    };
  } else {
    // Standard 4 Spieler
    return {
      maxCards: 13,
      rounds: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1],
      ranks: ALL_RANKS
    };
  }
};

const createDeck = (ranks) => {
  let deck = [];
  for (let suit of SUITS) {
    for (let i = 0; i < ranks.length; i++) {
      deck.push({
        id: `${suit}-${ranks[i]}`,
        suit: suit,
        rank: ranks[i],
        rankValue: ALL_RANKS.indexOf(ranks[i]) + 2, 
        isJoker: false,
      });
    }
  }
  deck.push({ id: 'joker_1', suit: 'none', rank: 'Joker', rankValue: 15, isJoker: true });
  deck.push({ id: 'joker_2', suit: 'none', rank: 'Joker', rankValue: 15, isJoker: true });
  
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

const generateRoundState = (rIndex, dealerIndex, numPlayers) => {
  const config = getGameConfig(numPlayers);
  const deck = createDeck(config.ranks);
  const numCards = config.rounds[rIndex];
  const newHands = Array.from({ length: numPlayers }, () => []);
  
  for (let i = 0; i < numPlayers; i++) {
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

  const startPlayer = (dealerIndex + 1) % numPlayers;

  return {
    roundIndex: rIndex,
    phase: 'bidding',
    dealer: dealerIndex,
    currentPlayer: startPlayer,
    trickLeader: startPlayer,
    hands: newHands,
    trick: [],
    bids: Array(numPlayers).fill(null),
    tricksWon: Array(numPlayers).fill(0),
    scores: Array(numPlayers).fill(0),
    scoreHistory: [],
    trumpCard: trump,
    message: `Runde ${rIndex + 1}: Ansagen!`,
    lastWinner: null
  };
};

export default function App() {
  const [user, setUser] = useState(null);
  const [userName, setUserName] = useState('');
  const [roomCodeInput, setRoomCodeInput] = useState('');
  const [currentRoomId, setCurrentRoomId] = useState(null);
  const [roomData, setRoomData] = useState(null);
  const [showScoreboard, setShowScoreboard] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [targetPlayers, setTargetPlayers] = useState(4); // 3, 4, oder 5

  const timerRef = useRef(null);

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

  useEffect(() => {
    if (!user || !currentRoomId || !db) return;
    
    const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'rooms', currentRoomId);
    const unsubscribe = onSnapshot(roomRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        if (data.gameState && typeof data.gameState === 'string') {
          try {
            data.gameState = JSON.parse(data.gameState);
          } catch (e) {
            console.error("Failed to parse gameState", e);
          }
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

  useEffect(() => {
    if (!roomData || !user || roomData.hostUid !== user.uid) return;
    
    const gs = roomData.gameState;
    if (!gs || roomData.status !== 'playing') return;

    clearTimeout(timerRef.current);
    const numPlayers = roomData.players.length;
    const isCurrentPlayerBot = roomData.players.find(p => p.seat === gs.currentPlayer)?.isBot;

    if (gs.phase === 'bidding' && isCurrentPlayerBot) {
      timerRef.current = setTimeout(() => {
        const handSize = gs.hands[gs.currentPlayer].length;
        const randomBid = Math.floor(Math.random() * (handSize / 2.5 + 1));
        executeBid(gs.currentPlayer, randomBid);
      }, 1500);
    } 
    else if (gs.phase === 'playing' && isCurrentPlayerBot) {
      timerRef.current = setTimeout(() => {
        const validCards = getValidCards(gs.hands[gs.currentPlayer], gs.trick, gs.trumpCard?.suit);
        if (validCards.length > 0) {
           const cardToPlay = validCards[Math.floor(Math.random() * validCards.length)];
           executePlayCard(gs.currentPlayer, cardToPlay);
        }
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

  const generateRoomCode = () => Math.random().toString(36).substring(2, 6).toUpperCase();

  const handleCreateRoom = async () => {
    if (!userName.trim()) { setErrorMsg("Bitte Namen eingeben"); return; }
    if (!db) return;
    const newRoomId = generateRoomCode();
    const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'rooms', newRoomId);
    
    await setDoc(roomRef, {
      id: newRoomId,
      hostUid: user.uid,
      status: 'waiting',
      targetPlayerCount: targetPlayers,
      players: [{ uid: user.uid, name: userName, isBot: false, seat: null }],
      gameState: null
    });
    
    setCurrentRoomId(newRoomId);
    setErrorMsg('');
  };

  const handleJoinRoom = async () => {
    if (!userName.trim()) { setErrorMsg("Bitte Namen eingeben"); return; }
    if (!roomCodeInput.trim()) { setErrorMsg("Bitte Code eingeben"); return; }
    if (!db) return;
    
    const code = roomCodeInput.trim().toUpperCase();
    const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'rooms', code);
    const docSnap = await getDoc(roomRef);
    
    if (docSnap.exists()) {
      const data = docSnap.data();
      if (data.status !== 'waiting') {
        setErrorMsg("Spiel läuft bereits.");
        return;
      }
      if (data.players.length >= data.targetPlayerCount) {
        setErrorMsg("Raum ist bereits voll für diese Spieleranzahl.");
        return;
      }
      if (data.players.some(p => p.uid === user.uid)) {
        setCurrentRoomId(code);
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
    if (roomData.hostUid !== user.uid || !db) return;
    
    let finalPlayers = [...roomData.players];
    const target = roomData.targetPlayerCount;
    let botCount = 1;
    while (finalPlayers.length < target) {
      finalPlayers.push({ uid: `bot-${Date.now()}-${botCount}`, name: `Bot ${botCount}`, isBot: true, seat: null });
      botCount++;
    }

    const seats = Array.from({ length: target }, (_, i) => i).sort(() => Math.random() - 0.5);
    finalPlayers.forEach((p, i) => p.seat = seats[i]);
    finalPlayers.sort((a, b) => a.seat - b.seat);

    const initialGs = generateRoundState(0, target - 1, target);
    const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'rooms', currentRoomId);
    
    await updateDoc(roomRef, {
      status: 'playing',
      players: finalPlayers,
      gameState: JSON.stringify(initialGs)
    });
  };

  const executeStartRound = async (rIndex, oldScores, oldHistory) => {
    if (!db) return;
    const numPlayers = roomData.players.length;
    const config = getGameConfig(numPlayers);

    if (rIndex >= config.rounds.length) {
      const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'rooms', currentRoomId);
      await updateDoc(roomRef, { status: 'finished' });
      return;
    }
    const dealerIndex = roomData.gameState.dealer;
    const nextDealer = (dealerIndex + 1) % numPlayers;
    const newGs = generateRoundState(rIndex, nextDealer, numPlayers);
    newGs.scores = oldScores;
    newGs.scoreHistory = oldHistory;
    
    const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'rooms', currentRoomId);
    await updateDoc(roomRef, { gameState: JSON.stringify(newGs) });
  };

  const executeBid = async (playerIndex, bid) => {
    if (!db) return;
    const numPlayers = roomData.players.length;
    const gs = JSON.parse(JSON.stringify(roomData.gameState));
    gs.bids[playerIndex] = bid;
    
    let nextPlayer = (gs.currentPlayer + 1) % numPlayers;
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
    if (!db) return;
    const numPlayers = roomData.players.length;
    const gs = JSON.parse(JSON.stringify(roomData.gameState));
    gs.hands[playerIndex] = gs.hands[playerIndex].filter(c => c.id !== card.id);
    gs.trick.push({ playerIndex, card });
    
    if (gs.trick.length === numPlayers) {
      gs.phase = 'trick_end';
      gs.currentPlayer = null;
    } else {
      gs.currentPlayer = (gs.currentPlayer + 1) % numPlayers;
      gs.message = `${roomData.players[gs.currentPlayer].name} spielt...`;
    }

    const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'rooms', currentRoomId);
    await updateDoc(roomRef, { gameState: JSON.stringify(gs) });
  };

  const executeResolveTrick = async () => {
    if (!db) return;
    const numPlayers = roomData.players.length;
    const gs = JSON.parse(JSON.stringify(roomData.gameState));
    const winner = determineWinner(gs.trick, gs.trumpCard?.suit);
    gs.tricksWon[winner] += 1;
    
    const handsEmpty = gs.hands[0].length === 0;

    if (handsEmpty) {
      for (let i = 0; i < numPlayers; i++) {
        const bid = gs.bids[i];
        const won = gs.tricksWon[i];
        if (bid === 0) {
          gs.scores[i] += won === 0 ? 10 : -(won * 10);
        } else {
          gs.scores[i] += won >= bid ? (bid * 10) + (won - bid) : -(bid * 10);
        }
      }
      
      const config = getGameConfig(numPlayers);
      gs.scoreHistory.push({
        roundIndex: gs.roundIndex,
        cards: config.rounds[gs.roundIndex],
        bids: [...gs.bids],
        won: [...gs.tricksWon],
        scores: [...gs.scores]
      });

      gs.phase = 'round_end';
      gs.trick = [];
      gs.message = `Runde beendet! ${roomData.players[winner].name} holt den Stich.`;
      gs.lastWinner = winner;
    } else {
      gs.phase = 'playing';
      gs.trick = [];
      gs.currentPlayer = winner;
      gs.trickLeader = winner;
      gs.message = `${roomData.players[winner].name} macht den Stich.`;
      gs.lastWinner = winner;
    }

    const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'rooms', currentRoomId);
    await updateDoc(roomRef, { gameState: JSON.stringify(gs) });
  };

  const renderCard = (card, isPlayable = false, onClick = null) => {
    if (!card) return null;
    const isRed = card.suit === 'hearts' || card.suit === 'diamonds';
    const suitSymbol = getSuitSymbol(card.suit);
    
    return (
      <div 
        onClick={() => isPlayable && onClick && onClick(card)}
        className={`w-14 h-20 sm:w-24 sm:h-36 bg-white rounded-xl shadow-xl border-2 border-slate-200 flex flex-col justify-between p-2 sm:p-3 select-none transform transition-all duration-200
          ${isPlayable ? 'cursor-pointer hover:-translate-y-4 hover:rotate-2 hover:border-green-400 z-10' : 'opacity-95'}
          ${card.isJoker ? 'text-purple-600 bg-purple-50' : isRed ? 'text-red-600' : 'text-slate-900'}`}
      >
        <div className="text-xs sm:text-lg font-black">{card.rank}</div>
        <div className="text-3xl sm:text-5xl text-center self-center drop-shadow-sm">{card.isJoker ? '🃏' : suitSymbol}</div>
        <div className="text-xs sm:text-lg font-black text-right rotate-180">{card.rank}</div>
      </div>
    );
  };

  const renderCardBack = () => (
    <div className="w-10 h-14 sm:w-16 sm:h-24 bg-gradient-to-br from-blue-700 to-blue-900 rounded-lg shadow-lg border-2 border-white flex items-center justify-center -ml-6 sm:-ml-10 first:ml-0 transform hover:translate-y-[-4px] transition-transform">
      <div className="w-[85%] h-[85%] border-2 border-blue-400 border-dashed opacity-40 rounded flex items-center justify-center">
        <span className="text-white text-opacity-40 text-[8px] sm:text-xs font-bold tracking-widest uppercase rotate-45">Oh Hell</span>
      </div>
    </div>
  );

  if (!user || !db) return (
    <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center text-white p-4">
      <div className="animate-spin h-10 w-10 border-4 border-blue-500 border-t-transparent rounded-full mb-4"></div>
      <p className="text-slate-400 font-medium">Lade Server...</p>
    </div>
  );

  if (!currentRoomId || !roomData) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
        <div className="bg-slate-900 p-8 rounded-3xl shadow-2xl text-center max-w-md w-full border border-slate-800 ring-1 ring-white/10">
          <h1 className="text-5xl font-black text-transparent bg-clip-text bg-gradient-to-br from-red-500 to-orange-400 mb-2">Oh Hell</h1>
          <p className="text-slate-500 mb-8 uppercase tracking-[0.2em] text-xs font-bold">Multiplayer Edition</p>
          
          {errorMsg && <div className="bg-red-500/10 text-red-400 border border-red-500/20 p-4 rounded-xl mb-6 text-sm font-medium">{errorMsg}</div>}

          <div className="space-y-6 text-left">
            <div>
              <label className="block text-slate-400 text-xs mb-2 font-bold uppercase tracking-widest">Dein Name</label>
              <input 
                value={userName} onChange={e => setUserName(e.target.value)}
                maxLength={12}
                className="w-full bg-slate-800 border-2 border-slate-700 text-white p-4 rounded-2xl focus:outline-none focus:border-blue-500 transition-colors text-lg font-medium"
                placeholder="Name eingeben..."
              />
            </div>
            
            <div className="flex flex-col gap-3">
              <div className="bg-slate-800 p-4 rounded-2xl border-2 border-slate-700">
                <label className="block text-slate-400 text-[10px] mb-3 font-bold uppercase tracking-widest text-center">Spieleranzahl festlegen</label>
                <div className="flex justify-center gap-4">
                  {[3, 4, 5].map(n => (
                    <button 
                      key={n}
                      onClick={() => setTargetPlayers(n)}
                      className={`w-12 h-12 rounded-xl font-black text-lg transition-all ${targetPlayers === n ? 'bg-blue-600 text-white scale-110 shadow-lg ring-2 ring-blue-400' : 'bg-slate-700 text-slate-400 hover:bg-slate-600'}`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>

              <button onClick={handleCreateRoom} className="w-full bg-gradient-to-r from-green-600 to-green-500 hover:from-green-500 hover:to-green-400 text-white font-black py-4 px-4 rounded-2xl shadow-xl transition-all transform hover:scale-[1.02] active:scale-[0.98]">
                RAUM ERSTELLEN
              </button>
              
              <div className="relative flex items-center py-2">
                <div className="flex-grow border-t border-slate-800"></div>
                <span className="flex-shrink mx-4 text-slate-600 text-xs font-bold uppercase tracking-widest">ODER</span>
                <div className="flex-grow border-t border-slate-800"></div>
              </div>

              <div className="flex gap-2">
                <input 
                  value={roomCodeInput} onChange={e => setRoomCodeInput(e.target.value.toUpperCase())}
                  maxLength={4}
                  className="w-1/2 bg-slate-800 border-2 border-slate-700 text-white p-4 rounded-2xl focus:outline-none focus:border-blue-500 uppercase text-center font-black tracking-widest text-xl"
                  placeholder="CODE"
                />
                <button onClick={handleJoinRoom} className="w-1/2 bg-slate-700 hover:bg-slate-600 text-white font-black py-4 px-4 rounded-2xl transition-all shadow-lg active:scale-95">
                  BEITRETEN
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (roomData.status === 'waiting') {
    const isHost = roomData.hostUid === user.uid;
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
        <div className="bg-slate-900 p-8 rounded-3xl shadow-2xl text-center max-w-md w-full border border-slate-800 relative overflow-hidden ring-1 ring-white/10">
          <div className="absolute top-0 right-0 bg-blue-600 text-white font-black px-6 py-2 rounded-bl-3xl shadow-lg">
            CODE: {roomData.id}
          </div>
          <h2 className="text-3xl font-black text-white mb-2 mt-6">Lobby</h2>
          <p className="text-slate-500 text-[10px] font-bold uppercase mb-6 tracking-widest">Modus: {roomData.targetPlayerCount} Spieler</p>
          <div className="bg-slate-950/50 rounded-2xl p-6 mb-8 space-y-4 text-left border border-slate-800">
            {roomData.players.map((p, i) => (
              <div key={i} className="flex justify-between items-center text-slate-300 border-b border-slate-800/50 pb-3 last:border-0 last:pb-0">
                <span className="font-bold flex items-center text-lg">
                   {p.name} {p.uid === user.uid && <span className="ml-3 text-[10px] bg-blue-500/20 px-2 py-0.5 rounded-full border border-blue-500/30 text-blue-400 font-black uppercase tracking-widest">Du</span>}
                </span>
                {p.uid === roomData.hostUid && <span className="bg-yellow-500/10 text-yellow-500 text-[10px] px-2 py-1 rounded-full font-black uppercase tracking-widest border border-yellow-500/20">Host</span>}
              </div>
            ))}
            {roomData.players.length < roomData.targetPlayerCount && (
              <p className="text-slate-600 text-center text-xs font-bold pt-4 animate-bounce">Warten auf Spieler ({roomData.players.length}/{roomData.targetPlayerCount})...</p>
            )}
          </div>
          {isHost ? (
            <button onClick={handleStartGame} className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-black py-5 px-8 rounded-2xl shadow-2xl transition-all transform hover:scale-[1.02] active:scale-[0.98] text-lg">
              JETZT STARTEN
            </button>
          ) : (
            <div className="p-4 bg-slate-800/50 rounded-xl text-slate-400 font-bold border border-slate-700 italic">Warte auf Host...</div>
          )}
        </div>
      </div>
    );
  }

  const gs = roomData.gameState;
  if (!gs) return null;

  const numPlayers = roomData.players.length;
  const config = getGameConfig(numPlayers);
  const myPlayer = roomData.players.find(p => p.uid === user.uid);
  const mySeat = myPlayer ? myPlayer.seat : 0;
  
  const sortedPlayers = [];
  for (let i = 0; i < numPlayers; i++) {
    sortedPlayers.push((mySeat + i) % numPlayers);
  }

  const validPlayerCards = gs.phase === 'playing' && gs.currentPlayer === mySeat 
    ? getValidCards(gs.hands[mySeat], gs.trick, gs.trumpCard?.suit) 
    : [];

  const getOpponentUI = (seatIdx, pos) => {
    const p = roomData.players.find(x => x.seat === seatIdx);
    if (!p || seatIdx === mySeat) return null;
    const isCurrent = gs.currentPlayer === seatIdx;

    let positionClasses = "";
    if (numPlayers === 3) {
      if (pos === 1) positionClasses = "top-10 left-10 rotate-[30deg]";
      if (pos === 2) positionClasses = "top-10 right-10 -rotate-[30deg]";
    } else if (numPlayers === 4) {
      if (pos === 1) positionClasses = "top-1/2 left-8 -translate-y-1/2 -rotate-90";
      if (pos === 2) positionClasses = "top-8 left-1/2 -translate-x-1/2";
      if (pos === 3) positionClasses = "top-1/2 right-8 -translate-y-1/2 rotate-90";
    } else if (numPlayers === 5) {
      if (pos === 1) positionClasses = "top-1/2 left-4 -translate-y-1/2 -rotate-90";
      if (pos === 2) positionClasses = "top-8 left-1/4 -translate-x-1/2 -rotate-15";
      if (pos === 3) positionClasses = "top-8 right-1/4 translate-x-1/2 rotate-15";
      if (pos === 4) positionClasses = "top-1/2 right-4 -translate-y-1/2 rotate-90";
    }

    return (
      <div className={`absolute ${positionClasses} flex flex-col items-center z-10 transition-transform duration-500 ${isCurrent ? 'scale-110' : 'scale-100'}`}>
        <div className={`px-4 py-2 rounded-2xl text-xs mb-3 text-center flex items-center space-x-4 backdrop-blur-xl border-2 transition-all shadow-2xl
          ${isCurrent ? 'bg-blue-600 border-white text-white ring-4 ring-blue-500/30' : 'bg-slate-900 border-slate-700 text-slate-300'}`}>
          <span className="font-black uppercase tracking-wider">{p.name}</span>
          <div className="flex gap-2">
            <span className="bg-black/30 px-2 py-0.5 rounded-lg font-mono font-bold text-yellow-400">{gs.scores[seatIdx]}</span>
            <span className="bg-black/30 px-2 py-0.5 rounded-lg font-mono font-bold text-green-400">{gs.tricksWon[seatIdx]}/{gs.bids[seatIdx] ?? '?'}</span>
          </div>
        </div>
        <div className="flex">
          {gs.hands[seatIdx].map((_, i) => <React.Fragment key={i}>{renderCardBack()}</React.Fragment>)}
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-[#073b1e] text-white font-sans flex flex-col overflow-hidden relative selection:bg-transparent bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-[#0c5c2e] via-[#073b1e] to-[#042412]">
      <div className="absolute inset-0 opacity-10 pointer-events-none" style={{backgroundImage: 'radial-gradient(#fff 1px, transparent 0)', backgroundSize: '40px 40px'}}></div>

      {/* Header */}
      <div className="bg-black/40 p-3 sm:p-5 flex justify-between items-center shadow-2xl z-30 backdrop-blur-md border-b border-white/5">
        <div className="flex items-center space-x-6">
          <div>
            <h1 className="text-xl sm:text-3xl font-black text-yellow-500 drop-shadow-lg italic">OH HELL!</h1>
            <div className="text-[10px] sm:text-xs text-slate-400 font-black uppercase tracking-widest mt-1">Runde {gs.roundIndex + 1} / {config.rounds.length}</div>
          </div>
          <div className="text-center bg-black/40 px-4 py-1 rounded-xl border border-white/10">
            <div className="text-[10px] text-slate-500 font-bold uppercase">Trumpf</div>
            {gs.trumpCard ? (
               <span className={`text-lg sm:text-2xl font-black ${gs.trumpCard.isJoker ? 'text-purple-400' : (gs.trumpCard.suit === 'hearts' || gs.trumpCard.suit === 'diamonds' ? 'text-red-500' : 'text-slate-200')}`}>
                 {gs.trumpCard.isJoker ? '🃏' : getSuitSymbol(gs.trumpCard.suit)} <span className="ml-1 font-mono">{gs.trumpCard.rank}</span>
               </span>
            ) : <span className="text-slate-600 font-black">-</span>}
          </div>
        </div>

        <div className="flex items-center space-x-3 sm:space-x-4">
          <button onClick={() => setShowRules(true)} className="bg-slate-800 hover:bg-slate-700 text-white w-10 h-10 sm:w-12 sm:h-12 flex items-center justify-center rounded-2xl shadow-lg transition-all border border-white/10">📖</button>
          <button onClick={() => setShowScoreboard(true)} className="bg-blue-600 hover:bg-blue-500 text-white font-black px-4 py-2 sm:px-6 sm:py-3 rounded-2xl shadow-xl transition-all border-b-4 border-blue-800 active:border-b-0 active:translate-y-1">📊 TABELLE</button>
        </div>
      </div>

      {/* Table Area */}
      <div className="flex-1 relative flex items-center justify-center p-4">
        {sortedPlayers.map((seatIdx, index) => getOpponentUI(seatIdx, index))}

        <div className="w-72 h-72 sm:w-[550px] sm:h-[550px] bg-black/20 rounded-full border-[12px] border-black/30 flex items-center justify-center relative shadow-[inset_0_0_100px_rgba(0,0,0,0.5)]">
          {gs.trick.map((t, idx) => {
             const playerSeatPos = sortedPlayers.indexOf(t.playerIndex);
             let posClass = "";
             // Visual positioning of played cards
             const angle = (playerSeatPos / numPlayers) * 360;
             const dist = numPlayers > 3 ? 120 : 80;
             posClass = `absolute`;
             
             return (
               <div 
                 key={t.card.id} 
                 className={`${posClass} transition-all duration-500 transform hover:scale-110`}
                 style={{
                   transform: `rotate(${angle}deg) translateY(${dist}px) rotate(${-angle}deg) translateX(-50%)`,
                   left: '50%',
                   top: '40%'
                 }}
               >
                 {renderCard(t.card)}
               </div>
             );
          })}
          {gs.trick.length === 0 && gs.phase === 'playing' && (
             <div className="bg-black/40 px-8 py-4 rounded-3xl border border-white/10 backdrop-blur-lg animate-pulse">
               <div className="text-yellow-500 font-black uppercase tracking-[0.3em] text-lg sm:text-2xl text-center">
                 {gs.currentPlayer === mySeat ? "Du bist dran" : "Warten..."}
               </div>
             </div>
          )}
        </div>
      </div>

      {/* Player Hand */}
      <div className="bg-black/60 p-4 pb-10 shadow-[0_-20px_50px_rgba(0,0,0,0.5)] z-40 backdrop-blur-xl border-t border-white/10">
        <div className="max-w-6xl mx-auto">
          <div className="flex justify-between items-center mb-6">
            <div className="flex items-center space-x-4">
              <div className="bg-gradient-to-r from-green-600 to-green-500 px-6 py-2 rounded-2xl shadow-lg">
                <span className="font-black text-white text-lg">{myPlayer?.name}</span>
              </div>
              <div className="bg-slate-900 px-4 py-2 rounded-2xl border border-white/10 flex space-x-4 font-mono font-bold">
                <span className="text-yellow-400">PKT: {gs.scores[mySeat]}</span>
                <span className="text-slate-500">|</span>
                <span className="text-green-400">STICHE: {gs.tricksWon[mySeat]}/{gs.bids[mySeat] ?? '?'}</span>
              </div>
            </div>
            <div className="text-right text-xs sm:text-sm text-yellow-400 font-black bg-yellow-500/10 px-4 py-2 rounded-xl border border-yellow-500/20 uppercase tracking-widest">{gs.message}</div>
          </div>

          <div className="flex justify-center gap-2 sm:gap-4 flex-wrap px-4 min-h-[120px]">
            {gs.hands[mySeat].map(card => {
              const isPlayable = gs.phase === 'playing' && gs.currentPlayer === mySeat && validPlayerCards.some(c => c.id === card.id);
              return <div key={card.id}>{renderCard(card, isPlayable, () => executePlayCard(mySeat, card))}</div>;
            })}
          </div>
        </div>
      </div>

      {/* Bidding Modal */}
      {gs.phase === 'bidding' && gs.currentPlayer === mySeat && (
        <div className="absolute inset-0 bg-black/70 z-50 flex items-center justify-center p-4 backdrop-blur-md">
          <div className="bg-slate-900 p-8 rounded-[40px] shadow-2xl border-4 border-blue-500 text-center max-w-lg w-full">
            <h2 className="text-4xl font-black text-white mb-2 uppercase italic tracking-tighter">Deine Ansage!</h2>
            <p className="text-slate-400 mb-8 font-bold text-sm uppercase tracking-widest">Wie viele Stiche holst du?</p>
            <div className="flex flex-wrap justify-center gap-3">
              {Array.from({ length: config.rounds[gs.roundIndex] + 1 }).map((_, i) => (
                <button key={i} onClick={() => executeBid(mySeat, i)} className="w-12 h-12 rounded-2xl bg-blue-600 hover:bg-blue-500 text-white font-black text-xl shadow-[0_4px_0_rgb(30,58,138)] active:shadow-none active:translate-y-1 transition-all">
                  {i}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* End of Round / Finished Overlay */}
      {(gs.phase === 'round_end' || roomData.status === 'finished') && (
        <div className="absolute inset-0 bg-black/80 z-50 flex flex-col items-center justify-center backdrop-blur-md p-4">
          <div className="bg-slate-900 p-8 rounded-[32px] shadow-2xl border border-slate-700 w-full max-w-2xl text-center">
            <h2 className="text-3xl sm:text-4xl font-black text-yellow-400 mb-6 uppercase tracking-tighter italic">
              {roomData.status === 'finished' ? 'ENDERGEBNIS' : 'RUNDEN-AUSWERTUNG'}
            </h2>
            <div className="overflow-x-auto rounded-2xl border border-slate-800">
              <table className="w-full text-left border-collapse bg-slate-950/50 text-white">
                <thead><tr className="bg-slate-800/80"><th className="p-4 text-xs uppercase tracking-widest font-black">Spieler</th><th className="p-4 text-xs uppercase tracking-widest font-black">Ansage</th><th className="p-4 text-xs uppercase tracking-widest font-black text-center">Gemacht</th><th className="p-4 text-xs uppercase tracking-widest font-black text-right">Punkte</th></tr></thead>
                <tbody>
                  {sortedPlayers.map(seatIndex => {
                    const p = roomData.players.find(x => x.seat === seatIndex);
                    const bid = gs.bids[seatIndex];
                    const won = gs.tricksWon[seatIndex];
                    return (
                      <tr key={seatIndex} className={`border-b border-slate-800/50 ${seatIndex === mySeat ? 'bg-blue-600/10' : ''}`}>
                        <td className="p-4 font-bold">{p?.name}</td>
                        <td className="p-4 text-slate-400">{bid}</td>
                        <td className={`p-4 text-center font-black ${won === bid ? 'text-green-500' : 'text-red-500'}`}>{won}</td>
                        <td className="p-4 text-right font-black text-yellow-500">{gs.scores[seatIndex]}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <button 
              onClick={() => setShowScoreboard(true)}
              className="mt-6 w-full bg-blue-600 hover:bg-blue-500 text-white font-black py-4 rounded-2xl transition-all"
            >
              GESAMTE TABELLE ANSEHEN
            </button>
            {roomData.status === 'finished' && (
              <button onClick={() => window.location.reload()} className="mt-4 text-slate-500 font-bold hover:text-white uppercase text-xs tracking-widest">Spiel verlassen</button>
            )}
          </div>
        </div>
      )}

      {/* Scoreboard Modal */}
      {showScoreboard && (
        <div className="absolute inset-0 bg-black/95 z-[100] flex flex-col items-center p-4 sm:p-10 backdrop-blur-2xl">
          <div className="bg-slate-900 rounded-[32px] shadow-2xl border border-slate-700 w-full max-w-6xl flex flex-col h-full overflow-hidden">
            <div className="p-6 flex justify-between items-center border-b border-slate-800 bg-slate-950/50">
               <h2 className="text-2xl sm:text-4xl font-black text-white italic">SCOREBOARD</h2>
               <button onClick={() => setShowScoreboard(false)} className="bg-red-600 text-white w-12 h-12 flex items-center justify-center rounded-2xl font-black text-2xl shadow-lg">&times;</button>
            </div>
            <div className="p-2 sm:p-6 overflow-auto flex-1 custom-scrollbar">
              <table className="w-full text-center border-separate border-spacing-y-2">
                <thead className="sticky top-0 bg-slate-900 z-10">
                  <tr>
                    <th className="p-4 text-slate-500 font-black uppercase text-[10px] tracking-widest text-left">Runde</th>
                    {Array.from({ length: numPlayers }).map((_, i) => <th key={i} className={`p-4 font-black uppercase text-[10px] tracking-widest ${i===mySeat ? 'text-blue-400' : 'text-slate-300'}`} colSpan={3}>{getPlayerLabel(i)}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {config.rounds.map((cards, rIdx) => {
                    const h = gs.scoreHistory.find(x => x.roundIndex === rIdx);
                    const isCurr = gs.roundIndex === rIdx;
                    return (
                      <tr key={rIdx} className={`rounded-xl overflow-hidden ${isCurr ? 'bg-blue-600/20' : 'bg-slate-950/30'}`}>
                        <td className="p-4 text-left font-black text-slate-400 border-l-4 border-slate-700">{rIdx + 1} ({cards})</td>
                        {Array.from({ length: numPlayers }).map((_, i) => h ? (
                          <React.Fragment key={i}>
                            <td className="p-3 bg-black/20 text-slate-500 text-xs">{h.bids[i]}</td>
                            <td className={`p-3 bg-black/20 font-black text-xs ${h.won[i] === h.bids[i] ? 'text-green-500' : 'text-red-500'}`}>{h.won[i]}</td>
                            <td className="p-3 bg-black/40 font-black text-yellow-500 text-xs border-r border-slate-800">{h.scores[i]}</td>
                          </React.Fragment>
                        ) : <td key={i} className="p-3 bg-black/10 text-slate-800" colSpan={3}>-</td>)}
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
        <div className="absolute inset-0 bg-black/95 z-[100] flex flex-col items-center justify-center p-4 backdrop-blur-2xl">
          <div className="bg-slate-900 rounded-[32px] shadow-2xl border border-slate-700 w-full max-w-2xl flex flex-col max-h-[85vh] overflow-hidden">
            <div className="p-6 bg-slate-950/50 flex justify-between items-center border-b border-slate-700 text-white">
               <h2 className="text-3xl font-black italic">REGELN</h2>
               <button onClick={() => setShowRules(false)} className="bg-red-600 text-white w-10 h-10 flex items-center justify-center rounded-xl font-black">&times;</button>
            </div>
            <div className="p-8 overflow-auto text-slate-300 space-y-6 text-sm sm:text-base">
              <div className="bg-blue-600/10 p-4 rounded-2xl border border-blue-500/20">
                <p className="font-bold text-blue-400 uppercase tracking-widest text-xs mb-2">Spieleranzahl & Karten</p>
                <p><strong>3 Spieler:</strong> Karten 2, 3 und 4 werden entfernt. 26 Runden.</p>
                <p><strong>4 Spieler:</strong> Normales Deck. 26 Runden.</p>
                <p><strong>5 Spieler:</strong> Normales Deck. 20 Runden (1-10, 10-1).</p>
              </div>
              <p>Triff deine Ansage exakt, um 10 Punkte Bonus zu erhalten. Wer am Ende die meisten Punkte hat, gewinnt!</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}