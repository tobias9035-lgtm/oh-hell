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

// Initialisierung der Firebase-Dienste außerhalb der Komponente
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// --- Hilfsfunktionen und Spieldaten ---
const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];
const ALL_RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'J', 'Q', 'K', '10', 'A'];

const getGameConfig = (numPlayers) => {
  if (numPlayers === 5) {
    return {
      cardsPerRound: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1],
      ranks: ALL_RANKS
    };
  } else if (numPlayers === 3) {
    return {
      cardsPerRound: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1],
      ranks: ['5', '6', '7', '8', '9', 'J', 'Q', 'K', '10', 'A']
    };
  } else {
    return {
      cardsPerRound: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1],
      ranks: ALL_RANKS
    };
  }
};

const createDeck = (ranks) => {
  let deck = [];
  for (let suit of SUITS) {
    for (let r of ranks) {
      deck.push({
        id: `${suit}-${r}`,
        suit: suit,
        rank: r,
        rankValue: ALL_RANKS.indexOf(r) + 2, 
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

const isTrumpCard = (card, trumpSuit) => card?.isJoker || (trumpSuit && card?.suit === trumpSuit);

const getValidCards = (hand, trick, trumpSuit) => {
  if (trick.length === 0) return hand; 
  const ledCard = trick[0].card;
  const ledSuit = ledCard.isJoker ? trumpSuit : ledCard.suit;
  const sameSuitCards = hand.filter(c => !c.isJoker && c.suit === ledSuit);
  if (sameSuitCards.length > 0) return [...sameSuitCards, ...hand.filter(c => c.isJoker)];
  return hand;
};

const determineWinner = (trick, trumpSuit) => {
  const ledCard = trick[0].card;
  const ledSuit = ledCard.isJoker ? trumpSuit : ledCard.suit;
  let winnerPlayerIndex = trick[0].playerIndex;
  let highestValue = -1;
  trick.forEach((t, index) => {
    let value = 0;
    if (t.card.isJoker) {
      const isFirstJoker = trick.findIndex(x => x.card.isJoker) === index;
      value = isFirstJoker ? 2000 : 1000;
    } else if (t.card.suit === trumpSuit) {
      value = 100 + t.card.rankValue;
    } else if (t.card.suit === ledSuit) {
      value = t.card.rankValue;
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
  const numCards = config.cardsPerRound[rIndex];
  const newHands = Array.from({ length: numPlayers }, () => []);
  for (let i = 0; i < numPlayers; i++) {
    for (let c = 0; c < numCards; c++) newHands[i].push(deck.pop());
    newHands[i].sort((a, b) => (a.suit === b.suit ? a.rankValue - b.rankValue : a.suit.localeCompare(b.suit)));
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
  const [targetPlayerCount, setTargetPlayerCount] = useState(4);

  const timerRef = useRef(null);

  // Authentifizierung mit Fallback auf Anonym
  useEffect(() => {
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          try {
            await signInWithCustomToken(auth, __initial_auth_token);
          } catch (e) {
            await signInAnonymously(auth);
          }
        } else {
          await signInAnonymously(auth);
        }
      } catch (err) {
        console.error("Auth initialization failure", err);
      }
    };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, []);

  // Datenbank-Sync
  useEffect(() => {
    if (!user || !currentRoomId) return;
    const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'rooms', currentRoomId);
    const unsubscribe = onSnapshot(roomRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        if (data.gameState && typeof data.gameState === 'string') data.gameState = JSON.parse(data.gameState);
        setRoomData(data);
      } else {
        setErrorMsg("Raum nicht gefunden.");
        setCurrentRoomId(null);
      }
    });
    return () => unsubscribe();
  }, [user, currentRoomId]);

  // Bot-Logik und Game Loop
  useEffect(() => {
    if (!roomData || !user || roomData.hostUid !== user.uid || roomData.status !== 'playing') return;
    const gs = roomData.gameState;
    if (!gs) return;
    clearTimeout(timerRef.current);
    const isBot = roomData.players.find(p => p.seat === gs.currentPlayer)?.isBot;

    if (gs.phase === 'bidding' && isBot) {
      timerRef.current = setTimeout(() => executeBid(gs.currentPlayer, Math.floor(Math.random() * (gs.hands[gs.currentPlayer].length / 2.5 + 1))), 1500);
    } else if (gs.phase === 'playing' && isBot) {
      timerRef.current = setTimeout(() => {
        const valid = getValidCards(gs.hands[gs.currentPlayer], gs.trick, gs.trumpCard?.suit);
        if (valid.length > 0) executePlayCard(gs.currentPlayer, valid[Math.floor(Math.random() * valid.length)]);
      }, 2000);
    } else if (gs.phase === 'trick_end') {
      timerRef.current = setTimeout(executeResolveTrick, 2500);
    } else if (gs.phase === 'round_end') {
      timerRef.current = setTimeout(() => executeStartRound(gs.roundIndex + 1, gs.scores, gs.scoreHistory), 5000);
    }
  }, [roomData?.gameState?.phase, roomData?.gameState?.currentPlayer, roomData?.gameState?.trick?.length, user]);

  const handleCreateRoom = async () => {
    if (!userName.trim() || !user) return;
    const code = Math.random().toString(36).substring(2, 6).toUpperCase();
    await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'rooms', code), {
      id: code, hostUid: user.uid, status: 'waiting', targetPlayerCount: targetPlayerCount,
      players: [{ uid: user.uid, name: userName, isBot: false, seat: null }], gameState: null
    });
    setCurrentRoomId(code);
  };

  const handleJoinRoom = async () => {
    if (!userName.trim() || !roomCodeInput.trim() || !user) return;
    const code = roomCodeInput.trim().toUpperCase();
    const roomRef = doc(db, 'artifacts', appId, 'public', 'data', 'rooms', code);
    const snap = await getDoc(roomRef);
    if (snap.exists()) {
      const data = snap.data();
      if (data.status !== 'waiting' || data.players.length >= data.targetPlayerCount) { setErrorMsg("Voll oder läuft bereits."); return; }
      await updateDoc(roomRef, { players: [...data.players, { uid: user.uid, name: userName, isBot: false, seat: null }] });
      setCurrentRoomId(code);
    }
  };

  const handleStartGame = async () => {
    if (!user || roomData.hostUid !== user.uid) return;
    let finalPlayers = [...roomData.players];
    let botCount = 1;
    while (finalPlayers.length < roomData.targetPlayerCount) {
      finalPlayers.push({ uid: `bot-${Date.now()}-${botCount}`, name: `Bot ${botCount}`, isBot: true, seat: null });
      botCount++;
    }
    const seats = Array.from({ length: roomData.targetPlayerCount }, (_, i) => i).sort(() => Math.random() - 0.5);
    finalPlayers.forEach((p, i) => p.seat = seats[i]);
    finalPlayers.sort((a, b) => a.seat - b.seat);
    const initialGs = generateRoundState(0, roomData.targetPlayerCount - 1, roomData.targetPlayerCount);
    await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'rooms', currentRoomId), { status: 'playing', players: finalPlayers, gameState: JSON.stringify(initialGs) });
  };

  const executeStartRound = async (rIdx, scores, history) => {
    const num = roomData.players.length;
    const config = getGameConfig(num);
    if (rIdx >= config.cardsPerRound.length) {
      await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'rooms', currentRoomId), { status: 'finished' });
      return;
    }
    const newGs = generateRoundState(rIdx, (roomData.gameState.dealer + 1) % num, num);
    newGs.scores = scores;
    newGs.scoreHistory = history;
    await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'rooms', currentRoomId), { gameState: JSON.stringify(newGs) });
  };

  const executeBid = async (idx, bid) => {
    const gs = JSON.parse(JSON.stringify(roomData.gameState));
    gs.bids[idx] = bid;
    const next = (gs.currentPlayer + 1) % roomData.players.length;
    if (next === gs.trickLeader) { gs.phase = 'playing'; gs.message = 'Spiel!'; }
    else { gs.currentPlayer = next; gs.message = `${roomData.players[next].name} sagt an.`; }
    await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'rooms', currentRoomId), { gameState: JSON.stringify(gs) });
  };

  const executePlayCard = async (idx, card) => {
    const gs = JSON.parse(JSON.stringify(roomData.gameState));
    gs.hands[idx] = gs.hands[idx].filter(c => c.id !== card.id);
    gs.trick.push({ playerIndex: idx, card });
    if (gs.trick.length === roomData.players.length) { gs.phase = 'trick_end'; gs.currentPlayer = null; }
    else gs.currentPlayer = (gs.currentPlayer + 1) % roomData.players.length;
    await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'rooms', currentRoomId), { gameState: JSON.stringify(gs) });
  };

  const executeResolveTrick = async () => {
    const gs = JSON.parse(JSON.stringify(roomData.gameState));
    const winner = determineWinner(gs.trick, gs.trumpCard?.suit);
    gs.tricksWon[winner] += 1;
    if (gs.hands[0].length === 0) {
      for (let i = 0; i < roomData.players.length; i++) {
        const b = gs.bids[i], w = gs.tricksWon[i];
        if (b === 0) gs.scores[i] += w === 0 ? 10 : -(w * 10);
        else gs.scores[i] += w >= b ? (b * 10) + (w - b) : -(b - w) * 10;
      }
      gs.scoreHistory.push({ roundIndex: gs.roundIndex, cards: getGameConfig(roomData.players.length).cardsPerRound[gs.roundIndex], bids: [...gs.bids], won: [...gs.tricksWon], scores: [...gs.scores] });
      gs.phase = 'round_end'; gs.trick = []; gs.message = 'Runde beendet!';
    } else { gs.phase = 'playing'; gs.trick = []; gs.currentPlayer = winner; gs.trickLeader = winner; }
    await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'rooms', currentRoomId), { gameState: JSON.stringify(gs) });
  };

  const renderCard = (card, playable = false, onClick = null) => {
    if (!card) return null;
    const isRed = card.suit === 'hearts' || card.suit === 'diamonds';
    return (
      <div key={card.id} onClick={() => playable && onClick && onClick(card)} className={`w-12 h-16 sm:w-16 sm:h-24 bg-white rounded-lg shadow-md border-2 flex flex-col justify-between p-1 sm:p-2 select-none transition-all transform ${playable ? 'cursor-pointer hover:-translate-y-4 border-blue-400 z-10' : 'border-slate-200'} ${isRed ? 'text-red-600' : 'text-slate-900'}`}>
        <div className="font-black text-[10px] sm:text-xs leading-none">{card.rank}</div>
        <div className="text-xl sm:text-3xl text-center self-center">{card.isJoker ? '🃏' : getSuitSymbol(card.suit)}</div>
        <div className="font-black text-[10px] sm:text-xs text-right rotate-180 leading-none">{card.rank}</div>
      </div>
    );
  };

  const renderCardBack = () => (
    <div className="w-8 h-12 sm:w-12 sm:h-18 bg-blue-800 rounded shadow-md border-2 border-white flex items-center justify-center -ml-4 sm:-ml-6 first:ml-0 overflow-hidden">
      <div className="w-full h-full border border-blue-400 opacity-30 m-0.5 sm:m-1 rounded-sm flex items-center justify-center">
        <span className="text-white text-opacity-30 text-[6px] sm:text-[8px] font-bold rotate-45 uppercase">Oh Hell</span>
      </div>
    </div>
  );

  if (!user) return <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-white p-8"><div className="animate-spin h-10 w-10 border-4 border-blue-500 border-t-transparent rounded-full mb-4"></div><p className="font-bold">Verbinde...</p></div>;

  if (!roomData) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
        <div className="bg-slate-900 p-8 rounded-3xl shadow-2xl text-center max-w-md w-full border border-slate-800 text-white">
          <h1 className="text-4xl font-black text-yellow-500 mb-6 italic tracking-tight uppercase">Oh Hell!</h1>
          <input value={userName} onChange={e => setUserName(e.target.value)} className="w-full bg-slate-800 border-2 border-slate-700 text-white p-4 rounded-xl mb-4 outline-none focus:border-blue-500 font-bold" placeholder="Dein Name..." />
          <div className="bg-slate-800 p-4 rounded-xl mb-4 border border-slate-700">
             <p className="text-[10px] uppercase font-black text-slate-400 mb-3 tracking-widest text-center">Spieleranzahl</p>
             <div className="flex justify-center gap-4">
                {[3, 4, 5].map(n => <button key={n} onClick={() => setTargetPlayerCount(n)} className={`w-12 h-12 rounded-lg font-black transition-all ${targetPlayerCount === n ? 'bg-blue-600 text-white shadow-lg scale-110' : 'bg-slate-700 text-slate-400'}`}>{n}</button>)}
             </div>
          </div>
          <button onClick={handleCreateRoom} className="w-full bg-green-600 font-black py-4 rounded-xl shadow-lg hover:bg-green-500 transition-all mb-4 uppercase">Raum Erstellen</button>
          <div className="flex gap-2">
            <input value={roomCodeInput} onChange={e => setRoomCodeInput(e.target.value.toUpperCase())} className="w-2/3 bg-slate-800 border border-slate-700 text-white p-4 rounded-xl text-center font-black tracking-widest" placeholder="CODE" />
            <button onClick={handleJoinRoom} className="w-1/3 bg-slate-700 font-black rounded-xl uppercase text-xs">Beitreten</button>
          </div>
        </div>
      </div>
    );
  }

  if (roomData.status === 'waiting') {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
        <div className="bg-slate-900 p-8 rounded-3xl shadow-2xl text-center max-w-sm w-full relative border border-slate-800 text-white text-left">
          <div className="absolute top-0 right-0 bg-yellow-500 text-slate-900 font-black px-4 py-1 rounded-bl-xl">{roomData.id}</div>
          <h2 className="text-2xl font-black mb-6 mt-4 uppercase">Warteraum</h2>
          <div className="space-y-3 mb-8">
            {roomData.players.map((p, i) => (
              <div key={p.uid || i} className="bg-slate-950/50 p-4 rounded-xl border border-slate-800 font-bold flex justify-between items-center text-white">
                <span>{p.name} {p.uid === roomData.hostUid && "👑"}</span>
                {p.uid === user.uid && <span className="text-[10px] bg-blue-600/40 text-blue-100 px-2 py-1 rounded uppercase">Du</span>}
              </div>
            ))}
          </div>
          {roomData.hostUid === user.uid ? <button onClick={handleStartGame} className="w-full bg-blue-600 font-black py-5 rounded-xl shadow-xl hover:bg-blue-500 uppercase tracking-widest">Start</button> : <p className="animate-pulse font-bold text-blue-400 uppercase text-xs tracking-widest text-center">Warte auf Host...</p>}
        </div>
      </div>
    );
  }

  const gs = roomData.gameState;
  const num = roomData.players.length;
  const config = getGameConfig(num);
  const myPlayer = roomData.players.find(p => p.uid === user.uid);
  const mySeat = myPlayer?.seat || 0;
  // Sitzordnung: ICH auf 6 Uhr (index 0 in sorted), dann im Uhrzeigersinn
  const sortedSeats = Array.from({ length: num }, (_, i) => (mySeat + i) % num);

  return (
    <div className="min-h-screen bg-[#073b1e] text-white flex flex-col overflow-hidden relative font-sans selection:bg-transparent">
      {/* Header */}
      <div className="bg-black/60 p-2 sm:p-4 flex justify-between items-center z-20 border-b border-white/5 shadow-xl backdrop-blur-md">
        <div>
           <h1 className="text-xl font-black text-yellow-500 italic drop-shadow-md">OH HELL!</h1>
           <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Runde {gs.roundIndex + 1} / {config.cardsPerRound.length}</p>
        </div>
        <div className="flex gap-4 items-center">
           <div className="bg-black/40 px-3 py-1 rounded-lg border border-white/10 text-center min-w-[70px]">
              <p className="text-[8px] text-slate-500 font-black uppercase">Trumpf</p>
              <p className={`text-xl font-black leading-none ${gs.trumpCard?.suit === 'hearts' || gs.trumpCard?.suit === 'diamonds' ? 'text-red-500' : 'text-slate-200'}`}>
                {gs.trumpCard ? (gs.trumpCard.isJoker ? '🃏' : getSuitSymbol(gs.trumpCard.suit) + gs.trumpCard.rank) : '-'}
              </p>
           </div>
           <button onClick={() => setShowRules(true)} className="bg-slate-800 w-10 h-10 flex items-center justify-center rounded-xl font-black shadow-lg">📖</button>
           <button onClick={() => setShowScoreboard(true)} className="bg-blue-600 font-black px-4 py-2 rounded-xl border-b-4 border-blue-800 uppercase text-xs tracking-widest">📊 Tabelle</button>
        </div>
      </div>

      <div className="flex-1 relative flex items-center justify-center p-4">
        {/* Gegner Positionierung */}
        {sortedSeats.map((seat, i) => {
          if (seat === mySeat) return null;
          const p = roomData.players.find(x => x.seat === seat);
          // Winkel: Wir wollen Ich (i=0) auf 6 Uhr (180 Grad).
          // i=1 ist links, i=2 oben etc.
          const angle = (i / num) * 360 + 180;
          return (
            <div key={`player-${seat}`} className="absolute flex flex-col items-center z-10 transition-all duration-500" style={{ transform: `rotate(${angle}deg) translateY(-220px) rotate(${-angle}deg)` }}>
              <div className={`px-3 py-1 rounded-full text-[10px] font-black shadow-xl border backdrop-blur-md transition-all ${gs.currentPlayer === seat ? 'bg-blue-600 border-white scale-110' : 'bg-black/60 border-slate-700 text-slate-300'}`}>
                {p?.name} <span className="ml-2 font-mono text-yellow-400">Pkt: {gs.scores[seat]}</span> <span className="ml-1 text-white opacity-50">|</span> <span className="ml-1 font-mono text-green-400">{gs.tricksWon[seat]} / {gs.bids[seat] ?? '?'}</span>
              </div>
              <div className="flex -space-x-4 mt-2">
                 {gs.hands[seat].map((_, idx) => <React.Fragment key={`hand-${seat}-${idx}`}>{renderCardBack()}</React.Fragment>)}
              </div>
            </div>
          );
        })}

        {/* Trick Area */}
        <div className="w-64 h-64 sm:w-96 sm:h-96 bg-black/10 rounded-full border-[10px] border-black/30 relative flex items-center justify-center shadow-[inset_0_0_100px_rgba(0,0,0,0.4)]">
          {gs.trick.map((t) => {
            const angleIdx = sortedSeats.indexOf(t.playerIndex);
            // i=0 (Ich) muss unten auf 6 Uhr landen.
            const angle = (angleIdx / num) * 360 + 180;
            return (
              <div key={`trick-card-${t.card.id}`} className="absolute transition-all duration-500" style={{ transform: `rotate(${angle}deg) translateY(-80px) rotate(${-angle}deg)` }}>
                {renderCard(t.card)}
              </div>
            );
          })}
          {gs.phase === 'bidding' && gs.currentPlayer === mySeat && (
            <div className="bg-slate-900/95 p-4 sm:p-6 rounded-[2rem] border-2 border-blue-500 shadow-[0_0_50px_rgba(37,99,235,0.4)] z-50 text-center animate-in zoom-in duration-300">
               <p className="text-xs font-black uppercase text-blue-400 mb-4 tracking-tighter leading-none">Deine Ansage!</p>
               <div className="flex flex-wrap justify-center gap-2 max-w-[280px]">
                  {Array.from({ length: config.cardsPerRound[gs.roundIndex] + 1 }).map((_, i) => (
                    <button key={`bid-${i}`} onClick={() => executeBid(mySeat, i)} className="w-9 h-9 sm:w-11 sm:h-11 bg-blue-600 rounded-xl font-black text-sm hover:bg-blue-500 transition-all shadow-[0_4px_0_rgb(30,58,138)] active:translate-y-1 text-white">{i}</button>
                  ))}
               </div>
            </div>
          )}
          {gs.phase === 'playing' && gs.currentPlayer === mySeat && gs.trick.length < num && (
            <div className="bg-yellow-500 text-black px-6 py-2 rounded-full font-black text-sm animate-bounce shadow-2xl uppercase">Du bist dran</div>
          )}
        </div>
      </div>

      {/* Spieler-Panel Unten */}
      <div className="bg-black/70 p-4 pb-10 shadow-[0_-20px_50px_rgba(0,0,0,0.5)] z-30 border-t border-white/10 backdrop-blur-xl">
        <div className="max-w-4xl mx-auto">
          <div className="flex justify-between items-center mb-6">
             <div className="flex items-center space-x-4">
                <div className="bg-gradient-to-r from-green-600 to-green-500 px-5 py-1.5 rounded-xl font-black shadow-xl border border-green-400/20 text-white uppercase text-xs tracking-widest">Ich ({myPlayer?.name})</div>
                <div className="bg-slate-900/80 px-4 py-1.5 rounded-xl border border-white/5 font-mono font-bold text-xs">
                  PKT: <span className="text-yellow-400">{gs.scores[mySeat]}</span> &nbsp;|&nbsp; STICHE: <span className="text-green-400">{gs.tricksWon[mySeat]}</span> / {gs.bids[mySeat] ?? '?'}
                </div>
             </div>
             <div className="text-[10px] sm:text-xs font-bold text-yellow-500 bg-yellow-500/10 px-4 py-1.5 rounded-full border border-yellow-500/20">{gs.message}</div>
          </div>
          <div className="flex justify-center gap-1.5 sm:gap-3 overflow-x-auto pb-4 min-h-[100px] px-2">
            {gs.hands[mySeat].map(c => {
               const valid = getValidCards(gs.hands[mySeat], gs.trick, gs.trumpCard?.suit);
               const playable = gs.phase === 'playing' && gs.currentPlayer === mySeat && valid.some(v => v.id === c.id);
               return renderCard(c, playable, () => executePlayCard(mySeat, c));
            })}
          </div>
        </div>
      </div>

      {/* Scoreboard Overlay */}
      {(showScoreboard || roomData.status === 'finished' || gs.phase === 'round_end') && (
        <div className="absolute inset-0 bg-black/95 z-[100] flex flex-col items-center p-4 sm:p-10 backdrop-blur-3xl overflow-hidden">
          <div className="bg-slate-900 rounded-[2.5rem] shadow-2xl border border-slate-700 w-full max-w-5xl flex flex-col h-full overflow-hidden text-white">
            <div className="p-6 flex justify-between items-center border-b border-slate-800 bg-slate-950/50">
               <h2 className="text-2xl sm:text-3xl font-black italic tracking-tighter uppercase text-white">Scoreboard</h2>
               {roomData.status !== 'finished' && gs.phase !== 'round_end' && (
                 <button onClick={() => setShowScoreboard(false)} className="bg-red-600 text-white w-10 h-10 flex items-center justify-center rounded-2xl font-black text-2xl shadow-xl transition-all hover:bg-red-500 text-white">&times;</button>
               )}
            </div>
            <div className="p-4 sm:p-6 overflow-auto flex-1 custom-scrollbar text-white">
              <table className="w-full text-center border-separate border-spacing-y-2">
                <thead className="sticky top-0 bg-slate-900 z-10 shadow-sm text-white">
                  <tr className="text-slate-400 uppercase font-black text-[10px] tracking-widest">
                    <th className="p-3 text-left">Rd</th>
                    {roomData.players.map(p => <th key={`header-${p.uid}`} className="p-3" colSpan={3}>{p.name}</th>)}
                  </tr>
                </thead>
                <tbody className="font-mono text-[10px] sm:text-xs text-white">
                  {config.cardsPerRound.map((cardCount, ri) => {
                    const h = gs.scoreHistory.find(x => x.roundIndex === ri);
                    return (
                      <tr key={`round-row-${ri}`} className={`rounded-xl transition-colors ${gs.roundIndex === ri ? 'bg-blue-600/20 ring-2 ring-blue-500/50' : 'bg-slate-950/40 hover:bg-white/5'}`}>
                        <td className="p-3 text-left font-black text-slate-400 bg-black/20 rounded-l-xl">{ri + 1} ({cardCount})</td>
                        {Array.from({ length: num }).map((_, pi) => {
                           if (!h) return <td key={`round-${ri}-player-${pi}`} colSpan={3} className="p-3 text-slate-800 italic">-</td>;
                           return (
                             <React.Fragment key={`round-${ri}-player-${pi}-data`}>
                               <td className="p-2 text-slate-400 bg-black/5">{h.bids[pi]}</td>
                               <td className={`p-2 font-black ${h.won[pi] === h.bids[pi] ? 'text-green-500' : 'text-red-500/70'}`}>{h.won[pi]}</td>
                               <td className="p-2 font-black text-yellow-400 bg-black/20 border-r border-slate-800/30 last:border-0">{h.scores[pi]}</td>
                             </React.Fragment>
                           );
                        })}
                      </tr>
                    );
                  })}
                  <tr className="bg-blue-600 font-black text-sm sm:text-base text-white sticky bottom-0 shadow-2xl border-t-4 border-blue-400">
                    <td className="p-4 text-left rounded-l-2xl uppercase italic">Gesamt</td>
                    {gs.scores.map((s, si) => <td key={`total-${si}`} colSpan={3} className={`p-4 ${si === num-1 ? 'rounded-r-2xl' : ''} text-yellow-300`}>{s} PKT</td>)}
                  </tr>
                </tbody>
              </table>
              {roomData.status === 'finished' && (
                <div className="mt-10 text-center animate-in slide-in-from-bottom duration-700">
                   <h3 className="text-4xl font-black text-yellow-500 mb-6 italic tracking-tighter uppercase">Spiel Beendet!</h3>
                   <button onClick={() => window.location.reload()} className="bg-white text-black font-black px-12 py-4 rounded-2xl shadow-2xl hover:bg-slate-200 transition-all uppercase tracking-widest text-sm transform hover:scale-105">Neues Spiel</button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Regeln Overlay */}
      {showRules && (
        <div className="absolute inset-0 bg-black/95 z-[100] flex flex-col items-center justify-center p-4 backdrop-blur-3xl text-white">
          <div className="bg-slate-900 rounded-[32px] shadow-2xl border border-slate-700 w-full max-w-2xl flex flex-col max-h-[85vh] overflow-hidden">
            <div className="p-6 bg-slate-950/50 flex justify-between items-center border-b border-slate-800 text-white">
               <h2 className="text-2xl font-black italic uppercase tracking-widest text-white">Spielregeln</h2>
               <button onClick={() => setShowRules(false)} className="bg-red-600 text-white w-10 h-10 flex items-center justify-center rounded-xl font-black text-white">&times;</button>
            </div>
            <div className="p-8 overflow-auto custom-scrollbar text-slate-300 space-y-6 text-sm leading-relaxed text-left text-white">
              <div className="bg-blue-600/10 p-5 rounded-2xl border border-blue-500/20 text-xs text-white">
                <p className="font-bold text-blue-400 uppercase tracking-widest text-[10px] mb-3">Punkte & Ablauf</p>
                <ul className="list-disc ml-5 space-y-2 text-white">
                  <li><strong>Getroffen:</strong> 10 Pkt + 1 Pkt pro Stich.</li>
                  <li><strong>Verfehlt:</strong> -10 Pkt pro Differenz-Stich zur Ansage.</li>
                  <li><strong>Null angesagt:</strong> +10 Pkt bei Erfolg, -10 Pkt pro Stich bei Misserfolg.</li>
                  <li>Es herrscht <strong>Bedienpflicht</strong>. Joker stechen alles.</li>
                  <li><strong>3 Spieler:</strong> Karten 2, 3 und 4 entfernt. 26 Runden.</li>
                  <li><strong>5 Spieler:</strong> Volles Deck. 20 Runden.</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}