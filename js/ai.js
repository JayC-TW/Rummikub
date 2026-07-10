// ai.js
// 電腦 AI 決策邏輯，依難度分為 初級 / 中級 / 高級。
// AI 只透過 rules.js 提供的合法性檢查函式做判斷，與玩家共用同一套規則引擎。
//
// 對外主要函式：decideAiTurn(context) -> action
// action 型態：
//   { type: 'meld', newSets: Tile[][] }                // 破冰：只用手牌組成的新牌組
//   { type: 'play', newSets: Tile[][], boardEdits: {index, tiles}[] } // 已破冰後的出牌
//   { type: 'draw' }                                    // 抽牌並結束回合

import { classifySet, isValidSet, MIN_MELD_VALUE, tileScoreValue } from './rules.js';

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 由一組牌（通常是手牌）列舉出所有可能的合法群組／順組候選 */
function enumerateSets(tiles) {
  const candidates = [];
  const jokers = tiles.filter((t) => t.isJoker);
  const reals = tiles.filter((t) => !t.isJoker);

  // 群組：依數字分堆
  const byNumber = new Map();
  for (const t of reals) {
    if (!byNumber.has(t.number)) byNumber.set(t.number, []);
    byNumber.get(t.number).push(t);
  }
  for (const [num, list] of byNumber) {
    // 去除同色重複（群組每色僅能一張）
    const byColor = new Map();
    for (const t of list) if (!byColor.has(t.color)) byColor.set(t.color, t);
    const distinct = [...byColor.values()];
    if (distinct.length >= 3) {
      candidates.push({ tiles: distinct.slice(0, Math.min(4, distinct.length)), type: 'group' });
      if (distinct.length > 3) candidates.push({ tiles: distinct.slice(0, 3), type: 'group' });
    }
    if (distinct.length === 3 && jokers.length >= 1) {
      candidates.push({ tiles: [...distinct, jokers[0]], type: 'group' });
    }
    void num;
  }

  // 順組：依顏色分堆
  const byColor = new Map();
  for (const t of reals) {
    if (!byColor.has(t.color)) byColor.set(t.color, []);
    byColor.get(t.color).push(t);
  }
  for (const [color, list] of byColor) {
    const numbersPresent = new Map();
    for (const t of list) if (!numbersPresent.has(t.number)) numbersPresent.set(t.number, t);
    for (let len = 13; len >= 3; len -= 1) {
      for (let start = 1; start <= 13 - len + 1; start += 1) {
        const end = start + len - 1;
        let missing = 0;
        const chosen = [];
        for (let n = start; n <= end; n += 1) {
          if (numbersPresent.has(n)) {
            chosen.push(numbersPresent.get(n));
          } else {
            missing += 1;
          }
        }
        if (missing > 0 && missing <= jokers.length && chosen.length >= 1) {
          const usedJokers = jokers.slice(0, missing);
          candidates.push({ tiles: [...chosen, ...usedJokers], type: 'run', color, start, end });
        } else if (missing === 0) {
          candidates.push({ tiles: chosen, type: 'run', color, start, end });
        }
      }
    }
  }

  // 過濾：以規則引擎再次確認合法
  return candidates.filter((c) => isValidSet(c.tiles));
}

/** 檢查候選牌組彼此是否使用了重複的牌（依 uid） */
function overlaps(setA, setB) {
  const ids = new Set(setA.map((t) => t.uid));
  return setB.some((t) => ids.has(t.uid));
}

/**
 * 從候選集合中挑選一組不重疊的組合，使總點數達到 target。
 * strategy: 'value'（點數優先） | 'tiles'（出牌張數優先，用於高級 AI 清空手牌）
 */
function pickMeldCombo(candidates, strategy) {
  if (candidates.length === 0) return null;
  let sorted;
  if (strategy === 'tiles') {
    sorted = [...candidates].sort((a, b) => b.tiles.length - a.tiles.length || classifySet(b.tiles).value - classifySet(a.tiles).value);
  } else {
    sorted = [...candidates].sort((a, b) => classifySet(b.tiles).value - classifySet(a.tiles).value);
  }

  const chosen = [];
  let sum = 0;
  for (const cand of sorted) {
    if (chosen.some((c) => overlaps(c.tiles, cand.tiles))) continue;
    chosen.push(cand);
    sum += classifySet(cand.tiles).meldValue; // 破冰點數不含百搭
    if (sum >= MIN_MELD_VALUE) break;
  }
  if (sum < MIN_MELD_VALUE) return null;

  // 高級策略：再嘗試加入更多不重疊的候選以出更多牌（多出不影響已達標的 sum）
  if (strategy === 'tiles') {
    for (const cand of sorted) {
      if (chosen.includes(cand)) continue;
      if (chosen.some((c) => overlaps(c.tiles, cand.tiles))) continue;
      chosen.push(cand);
    }
  }
  return chosen.map((c) => c.tiles);
}

function totalValueOf(hand) {
  return hand.reduce((s, t) => s + tileScoreValue(t), 0);
}

/** 嘗試把手牌一張張塞進既有桌面牌組（不拆組，只新增） */
function tryExtendBoard(hand, board, preferNonJokerFirst = true) {
  const remainingHand = hand.slice();
  const boardEdits = []; // { index, tiles }（最終該組的完整牌組）
  const workingBoard = board.map((s) => s.slice());

  let progressed = true;
  while (progressed) {
    progressed = false;
    const order = preferNonJokerFirst
      ? [...remainingHand].sort((a, b) => Number(a.isJoker) - Number(b.isJoker) || b.number - a.number)
      : remainingHand.slice();

    for (const tile of order) {
      for (let i = 0; i < workingBoard.length; i += 1) {
        const trial = [...workingBoard[i], tile];
        if (isValidSet(trial)) {
          workingBoard[i] = trial;
          const idx = remainingHand.findIndex((t) => t.uid === tile.uid);
          if (idx !== -1) remainingHand.splice(idx, 1);
          progressed = true;
          break;
        }
      }
      if (progressed) break;
    }
  }

  for (let i = 0; i < workingBoard.length; i += 1) {
    if (workingBoard[i].length !== board[i].length) {
      boardEdits.push({ index: i, tiles: workingBoard[i] });
    }
  }

  return { remainingHand, boardEdits };
}

function think(level) {
  const ranges = { basic: [400, 700], intermediate: [600, 1100], advanced: [800, 1500] };
  const [min, max] = ranges[level] || [500, 1000];
  return Math.round(min + Math.random() * (max - min));
}

/**
 * 主要決策函式。
 * context: { hand, board, hasMelded, level }
 * 回傳 action 物件（見檔頭說明），並附上 thinkMs 供 UI 顯示思考動畫時間。
 */
export function decideAiTurn(context) {
  const { hand, board, hasMelded, level } = context;
  const thinkMs = think(level);

  if (!hasMelded) {
    const candidates = enumerateSets(hand);
    let combo = null;
    if (level === 'basic') {
      combo = pickMeldCombo(shuffle(candidates), 'value');
    } else if (level === 'intermediate') {
      combo = pickMeldCombo(candidates, 'value');
    } else {
      combo = pickMeldCombo(candidates, 'tiles');
    }
    if (combo) return { type: 'meld', newSets: combo, thinkMs };
    return { type: 'draw', thinkMs };
  }

  // 已破冰
  if (level === 'basic') {
    // 常常保守抽牌：三成機率主動出牌，其餘抽牌
    const candidates = enumerateSets(hand);
    if (candidates.length > 0 && Math.random() < 0.4) {
      const pick = shuffle(candidates)[0];
      return { type: 'play', newSets: [pick.tiles], boardEdits: [], thinkMs };
    }
    return { type: 'draw', thinkMs };
  }

  if (level === 'intermediate') {
    const { remainingHand, boardEdits } = tryExtendBoard(hand, board, false);
    const candidates = enumerateSets(remainingHand).sort(
      (a, b) => classifySet(b.tiles).value - classifySet(a.tiles).value,
    );
    const newSets = [];
    let pool = remainingHand;
    for (const cand of candidates) {
      if (cand.tiles.every((t) => pool.some((p) => p.uid === t.uid))) {
        newSets.push(cand.tiles);
        const used = new Set(cand.tiles.map((t) => t.uid));
        pool = pool.filter((t) => !used.has(t.uid));
      }
    }
    if (boardEdits.length > 0 || newSets.length > 0) {
      return { type: 'play', newSets, boardEdits, thinkMs };
    }
    return { type: 'draw', thinkMs };
  }

  // advanced：多輪貪婪，優先出高點數、保留百搭
  let workingHand = hand.slice();
  let workingBoard = board.map((s) => s.slice());
  const newSets = [];
  const boardEditsMap = new Map();

  for (let pass = 0; pass < 3; pass += 1) {
    const { remainingHand, boardEdits } = tryExtendBoard(workingHand, workingBoard, true);
    for (const edit of boardEdits) {
      boardEditsMap.set(edit.index, edit.tiles);
      workingBoard[edit.index] = edit.tiles;
    }
    workingHand = remainingHand;

    const candidates = enumerateSets(workingHand).sort(
      (a, b) => b.tiles.length - a.tiles.length || totalValueOf(b.tiles) - totalValueOf(a.tiles),
    );
    let usedAny = false;
    let pool = workingHand;
    for (const cand of candidates) {
      if (cand.tiles.every((t) => pool.some((p) => p.uid === t.uid))) {
        newSets.push(cand.tiles);
        const used = new Set(cand.tiles.map((t) => t.uid));
        pool = pool.filter((t) => !used.has(t.uid));
        usedAny = true;
      }
    }
    workingHand = pool;
    if (boardEdits.length === 0 && !usedAny) break;
  }

  const boardEdits = [...boardEditsMap.entries()].map(([index, tiles]) => ({ index, tiles }));
  if (boardEdits.length > 0 || newSets.length > 0) {
    return { type: 'play', newSets, boardEdits, thinkMs };
  }
  return { type: 'draw', thinkMs };
}
