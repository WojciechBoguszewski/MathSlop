import React, { useEffect, useState, useRef } from "react";

// ================= CONSTANTS (łatwo dodać nowe powerupy / zmienić zasady) =================
const GAME = {
  START_LIVES: 3,
  ROUNDS_BEFORE_SHOP: 5,
  MAX_INVENTORY: 3,
  START_TIME_MS: 3000, // initial time per question (can be 1000..4000)
  MIN_TIME_MS: 1000,
  TIME_DECREASE_AFTER_SHOP: 200, // reduce available time after each shop
  BASE_POINT: 10,
};

const RARITY = {
  COMMON: "common",
  RARE: "rare",
  EPIC: "epic",
};

// helper: rarity weights for shop generation
const RARITY_WEIGHTS = {
  [RARITY.COMMON]: 70,
  [RARITY.RARE]: 25,
  [RARITY.EPIC]: 5,
};

// Power-up definitions: id, name, desc, price, rarity, oneTime, apply effect
// apply: function(context) returns {consumeImmediately: bool, note}
// Konfiguracja: dodaj obiekty tutaj by rozszerzyć sklep
const POWERUPS = [
  {
    id: "extra_life",
    name: "+2 Lives",
    desc: "Dodaje +2 życia natychmiast.",
    price: 120,
    rarity: RARITY.RARE,
    oneTime: true,
    apply: (ctx) => {
      ctx.setLives((l) => l + 2);
      return { consumed: true };
    },
  },
  {
    id: "double_2",
    name: "2x punkty (2 rundy)",
    desc: "Daje 2x punkty przez 2 następne rundy.",
    price: 150,
    rarity: RARITY.EPIC,
    oneTime: false,
    // when used, we store effect with roundsLeft
    onUseData: { name: "double", rounds: 2 },
    apply: (ctx) => {
      ctx.pushEffect({ type: "double", roundsLeft: 2 });
      return { consumed: true };
    },
  },
  {
    id: "time_bonus_points",
    name: "Bonus = ms pozostałe",
    desc: "Dodaje punkty równe pozostałym ms po poprawnej odpowiedzi.",
    price: 90,
    rarity: RARITY.COMMON,
    oneTime: false,
    apply: (ctx) => {
      ctx.pushEffect({ type: "timeBonus", roundsLeft: 1 });
      return { consumed: true };
    },
  },
  {
    id: "instant_points",
    name: "+200 Punkty",
    desc: "Natychmiastowe +200 punktów.",
    price: 200,
    rarity: RARITY.RARE,
    oneTime: true,
    apply: (ctx) => {
      ctx.setScore((s) => s + 200);
      return { consumed: true };
    },
  },
  {
    id: "add_time_ms",
    name: "+500ms (jednorazowo)",
    desc: "Dodaje 500ms do limitu czasu dla następnej rundy.",
    price: 70,
    rarity: RARITY.COMMON,
    oneTime: true,
    apply: (ctx) => {
      ctx.pushEffect({ type: "addTimeMs", ms: 5010, roundsLeft: 1 });
      return { consumed: true };
    },
  },
];

// ===================== Utility functions =====================
function weightedChoice(items, weightFn) {
  const total = items.reduce((s, it) => s + weightFn(it), 0);
  const r = Math.random() * total;
  let acc = 0;
  for (const it of items) {
    acc += weightFn(it);
    if (r <= acc) return it;
  }
  return items[items.length - 1];
}

function pickShopItems(count = 1) {
  const pool = POWERUPS;
  const picks = [];
  for (let i = 0; i < count; i++) {
    const pick = weightedChoice(pool, (p) => RARITY_WEIGHTS[p.rarity] || 1);
    // make price vary a bit
    picks.push({ ...pick, price: Math.max(10, Math.round(pick.price * (0.9 + Math.random() * 0.4))) });
  }
  return picks;
}

function generateProblem(difficulty = 1) {
  // difficulty affects range and included operations
  const max = 5 + difficulty * 5;
  const a = Math.floor(Math.random() * max) + 1;
  const b = Math.floor(Math.random() * Math.min(max, 10)) + 1;
  const ops = ["+"]; // start with addition
  if (difficulty >= 2) ops.push("-");
  if (difficulty >= 3) ops.push("*");
  const op = ops[Math.floor(Math.random() * ops.length)];
  let answer;
  if (op === "+") answer = a + b;
  if (op === "-") answer = a - b;
  if (op === "*") answer = a * b;
  return { a, b, op, answer };
}

// pixel-art simple sprite (returns style grid) - można tu dodać własne grafiki
function PixelSprite({ pattern = [], size = 8 }) {
  const grid = pattern;
  return (
    <div style={{ display: "inline-grid", gridTemplateColumns: `repeat(${grid[0].length}, ${size}px)`, imageRendering: "pixelated", marginRight: 8 }}>
      {grid.flat().map((c, i) => (
        <div key={i} style={{ width: size, height: size, background: c ? c : "transparent", border: c ? "1px solid rgba(0,0,0,0.08)" : undefined }} />
      ))}
    </div>
  );
}

// small pixel heart pattern
const HEART = [
  [0,1,1,0,0,1,1,0],
  [1,1,1,1,1,1,1,1],
  [1,1,1,1,1,1,1,1],
  [0,1,1,1,1,1,1,0],
  [0,0,1,1,1,1,0,0],
  [0,0,0,1,1,0,0,0],
];

// ===================== Main App =====================
export default function App() {
  const [lives, setLives] = useState(GAME.START_LIVES);
  const [score, setScore] = useState(0);
  const [round, setRound] = useState(1);
  const [correctCount, setCorrectCount] = useState(0);
  const [inventory, setInventory] = useState([]); // {id, data}
  const [effects, setEffects] = useState([]); // active effects: {type, roundsLeft, ms}
  const [inShop, setInShop] = useState(false);
  const [shopItems, setShopItems] = useState([]);
  const [timeLimit, setTimeLimit] = useState(GAME.START_TIME_MS);
  const [difficulty, setDifficulty] = useState(1);

  // problem state
  const [problem, setProblem] = useState(() => generateProblem(difficulty));
  const [answer, setAnswer] = useState("");
  const [countdown, setCountdown] = useState(timeLimit);
  const timerRef = useRef(null);
  const startedAtRef = useRef(null);
  const [gameOver, setGameOver] = useState(false);

  // create context helper used by powerups to affect global state
  const powerCtx = {
    setLives,
    setScore,
    pushEffect: (e) => setEffects((arr) => [...arr, e]),
  };

  // start next round
  function startRound(nextDifficulty = difficulty) {
    setProblem(generateProblem(nextDifficulty));
    setAnswer("");
    setCountdown(timeLimit);
    startedAtRef.current = performance.now();
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setCountdown((c) => {
        if (c <= 50) {
          clearInterval(timerRef.current);
          handleFail();
          return 0;
        }
        return c - 50;
      });
    }, 50);
  }

  // use effects each round advance
  function advanceEffectsOnRoundEnd() {
    setEffects((ef) => ef.map(e => ({...e, roundsLeft: e.roundsLeft ? e.roundsLeft - 1 : undefined})).filter(e => e.roundsLeft === undefined || e.roundsLeft > 0));
  }

  useEffect(() => {
    if (!gameOver && !inShop) startRound();
    return () => clearInterval(timerRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inShop, gameOver]);

  // answer handling
  function handleSubmitAnswer(ev) {
    ev?.preventDefault();
    if (gameOver || inShop) return;
    const numeric = Number(answer);
    clearInterval(timerRef.current);
    const msLeft = Math.max(0, countdown);
    if (numeric === problem.answer) {
      // correct
      setCorrectCount((c) => c + 1);
      // calculate points
      let base = GAME.BASE_POINT + Math.abs(problem.answer);
      // apply effects
      let multiplier = 1;
      if (effects.some(e => e.type === "double")) multiplier *= 2;
      let gained = Math.round(base * multiplier);
      if (effects.some(e => e.type === "timeBonus")) gained += Math.round(msLeft / 10); // e.g. ms/10
      // additionally, if there's an effect addTimeMs
      if (effects.some(e => e.type === "addTimeMs")) {
        // effect applied to next round via effects array; handled elsewhere
      }
      setScore((s) => s + gained);
      // next round prep
      nextRoundAfterSuccess();
    } else {
      // wrong
      handleFail();
    }
  }

  function handleFail() {
    clearInterval(timerRef.current);
    setLives((l) => {
      const newL = l - 1;
      if (newL <= 0) {
        setGameOver(true);
      }
      return newL;
    });
    // prepare next round or death
    if (!gameOver) {
      nextRoundAfterFail();
    }
  }

  function nextRoundAfterSuccess() {
    // consume single-use effects that should expire immediately (handled in advanceEffectsOnRoundEnd)
    advanceEffectsOnRoundEnd();

    // increment round and maybe open shop
    setRound((r) => {
      const nr = r + 1;
      if (nr % GAME.ROUNDS_BEFORE_SHOP === 0) {
        openShop();
      } else {
        // maybe modify timeLimit per round if some effect present
        setTimeout(() => {
          // apply addTimeMs effect for the next round by checking effects
          console.log(effects)
          const add = effects.find(e => e.type === "addTimeMs");
          if (add) setTimeLimit((t) => Math.min(t + (add.ms || 0), 10000));
          startRound(difficulty);
        }, 150);
      }
      return nr;
    });
  }

  function nextRoundAfterFail() {
    advanceEffectsOnRoundEnd();
    setRound((r) => r + 1);
    if (round % GAME.ROUNDS_BEFORE_SHOP === 0) openShop();
    else setTimeout(() => startRound(difficulty), 150);
  }

  function openShop() {
    setInShop(true);
    setShopItems(pickShopItems(1 + Math.floor(Math.random() * 3)));
  }

  function closeShop() {
    setInShop(false);
    // increase difficulty and reduce time
    setDifficulty(d => d + 1);
    setTimeLimit((t) => Math.max(GAME.MIN_TIME_MS, t - GAME.TIME_DECREASE_AFTER_SHOP));
  }

  function buyItem(item) {
    if (inventory.length >= GAME.MAX_INVENTORY) return alert("Brak miejsca w ekwipunku");
    if (score < item.price) return alert("Za mało punktów");
    setScore(s => s - item.price);
    setInventory(inv => [...inv, { ...item }]);
    setShopItems(si => si.filter(it => it !== item));
  }

  function use(idx) {
    const it = inventory[idx];
    if (!it) return;
    
    const res = it.apply(powerCtx) || {};
 
    const remove = it.oneTime || res.consumed;
    if (remove) setInventory(inv => inv.filter((_, i) => i !== idx));
  }

  function sellInventoryItem(idx) {
    const it = inventory[idx];
    if (!it) return;
    const sellPrice = Math.round((it.price || 0) * 0.5);
    setInventory(inv => inv.filter((_, i) => i !== idx));
    setScore(s => s + sellPrice);
  }

  function restart() {
    setLives(GAME.START_LIVES);
    setScore(0);
    setRound(1);
    setCorrectCount(0);
    setInventory([]);
    setEffects([]);
    setInShop(false);
    setShopItems([]);
    setTimeLimit(GAME.START_TIME_MS);
    setDifficulty(1);
    setGameOver(false);
    setProblem(generateProblem(1));
  }

  // UI small helpers
  const msLeft = countdown;

  return (
    <div style={{ fontFamily: "monospace", padding: 12, maxWidth: 900, margin: "0 auto",zoom:1.6 }}>
      <h1 style={{ fontSize: 20 }}>Pixel Math — gra edukacyjna</h1>

      {/* HUD */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
        <div style={{ display: "flex", alignItems: "center" }}>
          <PixelSprite pattern={HEART} size={10} />
          <div>Życia: {lives}</div>
        </div>
        <div>Punkty: {score}</div>
        <div>Runda: {round}</div>
        <div>Poprawne: {correctCount}</div>
      </div>

      {/* inventory */}
      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        {inventory.length === 0 ? <div>Brak power-upów</div> : (
          inventory.map((it, idx) => (
            <div key={idx} style={{ border: "1px solid #666", padding: 6, borderRadius: 6, minWidth: 120 }}>
              <div style={{ fontWeight: "bold" }}>{it.name}</div>
              <div style={{ fontSize: 12 }}>{it.desc}</div>
              <div style={{ marginTop: 6, display: "flex", gap: 6 }}>
                <button onClick={() => use(idx)}>Użyj</button>
                <button onClick={() => sellInventoryItem(idx)}>Sprzedaj ({Math.round((it.price||0)*0.5)})</button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Game area */}
      {!gameOver && !inShop && (
        <div style={{ border: "2px solid #222", padding: 12, borderRadius: 8, background: "#f6f6f6" }}>
          <div style={{ display: "flex", alignItems: "center" }}>
            <div style={{ fontSize: 36, width: 220, textAlign: "center" }}>{problem.a} {problem.op} {problem.b} = ?</div>
            <div style={{ marginLeft: 10 }}>
              <div>Time: {Math.ceil(msLeft / 1000)}s</div>
              <div style={{ height: 8, width: 140, background: "#ddd", borderRadius: 4 }}>
                <div style={{ height: 8, width: `${(msLeft / timeLimit) * 100}%`, background: "#4caf50", borderRadius: 4 }} />
              </div>
            </div>
          </div>
          <form onSubmit={handleSubmitAnswer} style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "center" }}>
            <input autoFocus value={answer} onChange={e => setAnswer(e.target.value)} style={{ fontSize: 20, padding: 8, width: 140 }} />
            <button type="submit">Sprawdź</button>
            <button type="button" onClick={() => { setAnswer(String(problem.answer)); handleSubmitAnswer(); }}>Podpowiedź (oddaje rundę)</button>
          </form>
        </div>
      )}

      {/* Shop screen */}
      {inShop && (
        <div style={{ border: "2px dashed #666", padding: 12, borderRadius: 8, marginTop: 12 }}>
          <h3>Sklep — wybierz przedmiot</h3>
          <div style={{ display: "flex", gap: 12 }}>
            {shopItems.map((it, i) => (
              <div key={i} style={{ border: "1px solid #333", padding: 8, borderRadius: 6, width: 220 }}>
                <div style={{ fontWeight: "bold" }}>{it.name} <small>({it.rarity})</small></div>
                <div style={{ fontSize: 13 }}>{it.desc}</div>
                <div style={{ marginTop: 6 }}>Cena: {it.price}</div>
                <div style={{ marginTop: 6, display: "flex", gap: 6 }}>
                  <button onClick={() => buyItem(it)}>Kup</button>
                </div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 12 }}>
            <button onClick={() => closeShop()}>Play (kontynuuj)</button>
          </div>
        </div>
      )}

      {/* Game over */}
      {gameOver && (
        <div style={{ marginTop: 18, padding: 12, border: "3px solid #900", borderRadius: 8, background: "#fff0f0" }}>
          <h2>GAME OVER</h2>
          <div>Poprawnych odpowiedzi: {correctCount}</div>
          <div>Zdobyte punkty: {score}</div>
          <div>Osiągnięta runda: {round}</div>
          <div style={{ marginTop: 8 }}>
            <button onClick={restart}>Restart</button>
          </div>
        </div>
      )}

      <div style={{ marginTop: 12, fontSize: 12, color: "#444" }}>
        <div>Ustawienia i power-upy w pliku: CONSTs na górze. Dodaj nowy obiekt do POWERUPS, ustaw apply, cenę i rarity.</div>
      </div>
    </div>
  );
}



