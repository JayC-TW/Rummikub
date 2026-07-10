// rules.js
// 拉密（Rummikub）規則引擎：牌堆建立、牌組合法性驗證、分數計算。
// 此模組為純函式集合，不觸碰 DOM，供 game.js 與 ai.js 共用，確保玩家與電腦使用同一套規則。

export const COLORS = ['red', 'blue', 'black', 'orange'];
export const COLOR_NAMES = { red: '紅', blue: '藍', black: '黑', orange: '橙' };
export const MIN_MELD_VALUE = 30;
export const JOKER_PENALTY_VALUE = 30;

let tileUid = 0;

/** 建立一張牌 */
function makeTile(color, number, isJoker = false) {
  tileUid += 1;
  return { uid: `t${tileUid}`, color, number, isJoker };
}

/** 建立完整 106 張牌堆（104 數字牌 + 2 百搭），並回傳洗牌後的陣列 */
export function createDeck() {
  const tiles = [];
  for (const color of COLORS) {
    for (let n = 1; n <= 13; n += 1) {
      tiles.push(makeTile(color, n));
      tiles.push(makeTile(color, n));
    }
  }
  tiles.push(makeTile(null, null, true));
  tiles.push(makeTile(null, null, true));
  return shuffle(tiles);
}

export function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 單張牌用於「牌堆抽完仍無人獲勝」或百搭懲罰計分時的點數 */
export function tileScoreValue(tile) {
  return tile.isJoker ? JOKER_PENALTY_VALUE : tile.number;
}

export function handScore(hand) {
  return hand.reduce((sum, t) => sum + tileScoreValue(t), 0);
}

/**
 * 驗證一組牌（順組或群組），回傳
 * { valid, type: 'group'|'run', value, meldValue } 或 { valid: false }
 * value：整組點數（百搭以其代表的數字計算），用於一般顯示。
 * meldValue：破冰計分用點數（百搭不計分，只加總真牌數字）。
 * 牌組內順序不影響驗證結果（僅看牌的多重集合）。
 */
export function classifySet(tiles) {
  if (!tiles || tiles.length < 3) return { valid: false };
  const jokers = tiles.filter((t) => t.isJoker);
  const reals = tiles.filter((t) => !t.isJoker);
  if (reals.length === 0) return { valid: false }; // 不可全為百搭
  const meldValue = reals.reduce((s, t) => s + t.number, 0); // 破冰只算真牌

  // --- 嘗試群組：同數字、不同顏色 ---
  const sameNumber = reals.every((t) => t.number === reals[0].number);
  if (sameNumber) {
    const colorSet = new Set(reals.map((t) => t.color));
    if (colorSet.size === reals.length && tiles.length <= 4) {
      const n = reals[0].number;
      const value = n * tiles.length; // 百搭代表相同數字
      return { valid: true, type: 'group', value, meldValue, number: n };
    }
  }

  // --- 嘗試順組：同顏色、連續數字（1 不接 13） ---
  const sameColor = reals.every((t) => t.color === reals[0].color);
  if (sameColor) {
    const numbers = reals.map((t) => t.number);
    const uniqueNumbers = new Set(numbers);
    if (uniqueNumbers.size === reals.length) {
      const len = tiles.length;
      for (let start = 1; start <= 13 - len + 1; start += 1) {
        const end = start + len - 1;
        const inRange = numbers.every((n) => n >= start && n <= end);
        if (inRange) {
          // 缺的位置用百搭補上，數量需吻合
          const missing = len - reals.length;
          if (missing === jokers.length) {
            let value = 0;
            for (let n = start; n <= end; n += 1) value += n;
            return { valid: true, type: 'run', value, meldValue, color: reals[0].color, start, end };
          }
        }
      }
    }
  }

  return { valid: false };
}

export function isValidSet(tiles) {
  return classifySet(tiles).valid;
}

/** 驗證整個桌面（多組牌）是否每組皆合法 */
export function isValidBoard(board) {
  return board.every((set) => isValidSet(set));
}

/** 計算整個桌面所有牌組的破冰點數總和（僅在計算本回合新出牌組時使用） */
export function totalMeldValue(sets) {
  return sets.reduce((sum, set) => {
    const r = classifySet(set);
    return sum + (r.valid ? r.value : 0);
  }, 0);
}
