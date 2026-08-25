(() => {
  "use strict";

  // =========================================================
  // アセット設定
  // 画像・効果音を用意したら、ここのパスを差し替えるだけでOK。
  // null のままなら仮素材（プレースホルダー）で動作する。
  // =========================================================
  const ASSETS = {
    playerImage: "assets/player.png",
    gameOverImage: "assets/gameover.jpeg",
    hitSound: null,         // 例: "assets/hit.mp3"
    obstacleImages: [       // 文字の「まさよし」に加えて出現する画像障害物
      "assets/masayoshi1.jpeg",
      "assets/masayoshi2.jpeg",
    ],
  };

  // =========================================================
  // Supabase（共有ランキング）設定
  // ビルド工程なしの静的サイト（GitHub Pages）構成のため、
  // publishable key はこのファイルに直接埋め込む想定。
  // これはSupabaseのanon/publishable keyの想定される使い方であり、
  // 実際のアクセス制御は Supabase 側の Row Level Security (RLS) で行う。
  // 下記2つを実際のプロジェクトの値に書き換えてから使用すること。
  //   - leaderboard テーブルへの INSERT を anon ロールに許可
  //   - leaderboard テーブルからの SELECT を anon ロールに許可
  //   - UPDATE / DELETE は anon ロールに許可しない
  // =========================================================
  const SUPABASE_URL = "https://ublfwmttxpweqpkbvskq.supabase.co"; // 例: "https://xxxxxxxx.supabase.co"
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_76B05TxjSDaHsd1gLedV5A_gZoGczOo";
  const LEADERBOARD_TABLE = "leaderboard";
  const LEADERBOARD_FETCH_LIMIT = 1000; // 身内ゲーム想定の件数で十分な上限

  let supabaseClient = null;
  try {
    const isConfigured =
      SUPABASE_URL && !SUPABASE_URL.startsWith("YOUR_") &&
      SUPABASE_PUBLISHABLE_KEY && !SUPABASE_PUBLISHABLE_KEY.startsWith("YOUR_");
    if (isConfigured && window.supabase && typeof window.supabase.createClient === "function") {
      // ログイン機能は使わないため、認証セッションの永続化は行わない
      supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
        auth: { persistSession: false },
      });
    }
  } catch (e) {
    supabaseClient = null; // 初期化に失敗してもゲーム自体は通常通り遊べるようにする
  }

  // =========================================================
  // ゲーム設定
  // =========================================================
  const CONFIG = {
    // ゲームフィールドのサイズはCSS側(100%/100dvh)で決まる。JSは#appの実測サイズを読むだけ。

    keyboardSpeed: 300,        // px/秒
    touchSensitivity: 1.25,    // 指のスライド量に対する移動倍率

    // プレイヤーの見た目（表示サイズ）。縦横比は画像から自動計算するため高さは指定しない。
    playerVisualWidth: 72,
    titlePlayerVisualWidth: 64, // タイトル画面の演出用キャラの表示幅

    // プレイヤーの当たり判定（見た目とは別に管理。小さめ＆本体中心寄りにして理不尽な被弾を防ぐ）
    // ※ヘッドバンドの結び目・こぶし・靴・汗などは含めず、体の中心の丸い部分だけをカバーする想定。
    //   見た目とズレる場合はここの3つの値だけを調整すればよい。
    playerHitboxRadius: 15,           // 当たり判定の半径(px)
    playerHitboxOffsetXRatio: -0.07,  // 中心からのXオフセット（表示幅に対する比率／左向き基準・反転時は自動で符号反転）
    playerHitboxOffsetYRatio: -0.03,  // 中心からのYオフセット（表示高さに対する比率）

    playerMoveIdleMs: 120,     // これ以上入力が無ければ「停止中」とみなし走行アニメを止める(ms)

    enemyText: "まさよし",
    enemySpawnMargin: 60,
    enemyFontMin: 16,
    enemyFontMax: 34,
    enemySpeedMin: 55,
    enemySpeedMax: 130,
    enemyDirDeviation: 0.45,   // 進行方向のランダムなブレ（ラジアン）
    enemySpinChance: 0.35,
    enemySpinSpeedMax: 200,    // 度/秒
    enemyHitboxShrink: 0.82,   // 見た目より少し小さめの当たり判定にして理不尽さを軽減

    // 敵の種類の出現率（合計1.0になるようにする）
    enemyTextRatio: 0.6,
    enemyImage1Ratio: 0.2,
    enemyImage2Ratio: 0.2,

    // 画像障害物のサイズ（gameW に対する比率。縦横比は元画像を維持）
    imageObstacleSizeMinRatio: 0.09,
    imageObstacleSizeMaxRatio: 0.32,
    imageObstacleHugeChance: 0.05,        // ごく低確率で巨大サイズが出現
    imageObstacleHugeSizeMinRatio: 0.42,
    imageObstacleHugeSizeMaxRatio: 0.62,  // 完全に回避不能にならないよう画面幅の6割程度が上限
    imageObstacleHitboxShrink: 0.88,

    // 画像障害物の出現保証（20秒以上出ないことがないようにする）
    firstImageForceMin: 7,     // 開始からこの秒数〜
    firstImageForceMax: 10,    // この秒数の間に必ず最初の1枚を出す
    imageForceGapSeconds: 15,  // 最後の画像出現からこの秒数経過したら次は必ず画像にする

    spawnIntervalStart: 1.15,  // 秒
    spawnIntervalMin: 0.15,
    spawnIntervalDecayPerSec: 0.016,

    speedMultiplierMax: 2.6,
    speedMultiplierGrowPerSec: 0.024,

    maxEnemies: 90,            // 安全のための上限

    // ゲームオーバー演出のタイミング（すべて接触した瞬間=0msからの絶対時間）
    gameOverFlashMs: 180,          // 白フラッシュの長さ（0.1〜0.2秒）
    gameOverShakeMs: 400,          // 画面揺れの長さ
    gameOverImageAppearMs: 180,    // 白フラッシュの直後に画像＋「ドン！！」を出す
    gameOverDonVisibleMs: 550,     // 「ドン！！」が出てから消えるまでの長さ
    gameOverTauntDelayMs: 300,     // 画像出現から煽り文句が出るまでの遅延
    gameOverActionsDelayMs: 3000,  // 接触からボタン群を表示するまでの時間

    // ゲームオーバー時にランダム表示する煽り文句
    gameOverTaunts: [
      "ざっこ。",
      "え、もう？",
      "それ避けれない？",
      "才能ないよ。",
      "今の当たるんだ。",
      "まさよし以下。",
      "よわ！！。",
      "向いてないよ。",
      "もう一回やる？笑",
      "おつかれ。",
    ],
  };

  // =========================================================
  // DOM参照
  // =========================================================
  const appEl = document.getElementById("app");
  const titleScreen = document.getElementById("title-screen");
  const titleDecoBack = document.getElementById("title-deco-back");
  const titleDecoFront = document.getElementById("title-deco-front");
  const titlePlayerEl = document.getElementById("title-player");
  const startBtn = document.getElementById("start-btn");
  const retryBtn = document.getElementById("retry-btn");
  const backToTitleBtn = document.getElementById("back-to-title-btn");
  const gameContainer = document.getElementById("game-container");
  const timerEl = document.getElementById("timer");
  const playerEl = document.getElementById("player");
  const playerBobEl = document.getElementById("player-bob");
  const playerSpriteEl = document.getElementById("player-sprite");
  const gameoverFlashEl = document.getElementById("gameover-flash");
  const gameoverOverlayEl = document.getElementById("gameover-overlay");
  const gameoverImageEl = document.getElementById("gameover-image");
  const gameoverDonEl = document.getElementById("gameover-don");
  const gameoverTauntEl = document.getElementById("gameover-taunt");
  const gameoverActionsEl = document.getElementById("gameover-actions");
  const survivedTimeEl = document.getElementById("survived-time");

  // ランキング／プレイヤー名まわりのDOM参照
  const top3StatusEl = document.getElementById("top3-status");
  const top3ListEl = document.getElementById("top3-list");
  const openRankingBtn = document.getElementById("open-ranking-btn");
  const nameModalBackdropEl = document.getElementById("name-modal-backdrop");
  const nameModalEl = document.getElementById("name-modal");
  const nameInputEl = document.getElementById("name-input");
  const nameConfirmBtn = document.getElementById("name-confirm-btn");
  const rankingBackdropEl = document.getElementById("ranking-backdrop");
  const rankingPanelEl = document.getElementById("ranking-panel");
  const rankingCloseBtn = document.getElementById("ranking-close-btn");
  const rankingStatusEl = document.getElementById("ranking-status");
  const rankingFullListEl = document.getElementById("ranking-full-list");

  // プレイヤー画像の適用（仮素材フォールバック）。タイトル画面の演出用キャラにも同じ画像を使う。
  function applyPlayerImageOrEmoji(el, fallbackEmoji) {
    if (ASSETS.playerImage) {
      el.style.backgroundImage = `url("${ASSETS.playerImage}")`;
      el.textContent = "";
    } else {
      el.textContent = fallbackEmoji;
    }
  }
  applyPlayerImageOrEmoji(playerSpriteEl, "🙂");
  applyPlayerImageOrEmoji(titlePlayerEl, "😱");

  // プレイヤー画像の縦横比プリロード。読み込み完了後、表示サイズ（幅固定・高さは比率から算出）を反映する。
  // 縦横比が判明するまでは正方形として扱っておき、読み込み完了時に正しい比率へ更新する。
  const playerImageData = { ratio: 1, ready: false };

  function sizePlayerBox(el, width) {
    const h = playerImageData.ready ? width / playerImageData.ratio : width;
    el.style.width = `${width}px`;
    el.style.height = `${h}px`;
  }
  sizePlayerBox(playerEl, CONFIG.playerVisualWidth);
  sizePlayerBox(titlePlayerEl, CONFIG.titlePlayerVisualWidth);

  if (ASSETS.playerImage) {
    const preloadImg = new Image();
    preloadImg.onload = () => {
      playerImageData.ratio = preloadImg.naturalWidth / preloadImg.naturalHeight;
      playerImageData.ready = true;
      sizePlayerBox(playerEl, CONFIG.playerVisualWidth);
      sizePlayerBox(titlePlayerEl, CONFIG.titlePlayerVisualWidth);
    };
    preloadImg.src = ASSETS.playerImage;
  }

  // ゲームオーバー画像（gameover.jpeg）の中身を準備（仮素材フォールバック付き）
  function prepareGameOverImage() {
    if (ASSETS.gameOverImage) {
      gameoverImageEl.style.backgroundImage = `url("${ASSETS.gameOverImage}")`;
      gameoverImageEl.textContent = "";
    } else {
      gameoverImageEl.style.backgroundImage = "none";
      gameoverImageEl.style.backgroundColor = "#3a0d0d";
      gameoverImageEl.textContent = "💥";
    }
  }
  prepareGameOverImage();

  // 画像障害物のプリロード。縦横比を保って表示するため、
  // 読み込み完了時に naturalWidth/naturalHeight から比率を取得しておく。
  const obstacleImages = ASSETS.obstacleImages.map((src) => {
    const data = { src, ratio: 1, ready: false };
    const img = new Image();
    img.onload = () => {
      data.ratio = img.naturalWidth / img.naturalHeight;
      data.ready = true;
    };
    img.src = src;
    return data;
  });

  // 効果音（あれば再生、無ければ何もしない）
  let hitAudio = null;
  if (ASSETS.hitSound) {
    hitAudio = new Audio(ASSETS.hitSound);
  }
  function playHitSound() {
    if (!hitAudio) return;
    try {
      hitAudio.currentTime = 0;
      hitAudio.play().catch(() => {});
    } catch (e) {
      // 再生できなくても無視
    }
  }

  // =========================================================
  // ゲームエリアのリサイズ（PC・スマホともブラウザの表示領域いっぱいを使う）
  // 実際のサイズは #app に設定した CSS（width:100% / height:100dvh）が決めるため、
  // ここではその結果を読み取って gameW/gameH に反映するだけでよい。
  // 100dvh によりSafari等のアドレスバー分の伸縮にもCSS側で自動追従する。
  // =========================================================
  let gameW = 0;
  let gameH = 0;

  function resizeGameContainer() {
    gameW = appEl.clientWidth;
    gameH = appEl.clientHeight;

    // プレイヤーが画面外に出ないようクランプ（見た目のスプライト全体が画面内に収まる基準）
    if (state === "playing" || state === "title") {
      clampPlayer();
      updatePlayerPosition();
    }
  }

  // =========================================================
  // 共有ランキング（Supabase）
  // 通信に失敗しても例外を投げず、ゲーム本体には一切影響させない設計にする。
  // =========================================================
  const PLAYER_NAME_STORAGE_KEY = "masayoshi-game:player-name";
  const MEDAL_BADGES = ["🥇", "🥈", "🥉"];

  function getStoredPlayerName() {
    try {
      return (localStorage.getItem(PLAYER_NAME_STORAGE_KEY) || "").trim();
    } catch (e) {
      return "";
    }
  }

  function storePlayerName(name) {
    try {
      localStorage.setItem(PLAYER_NAME_STORAGE_KEY, name);
    } catch (e) {
      // 保存できない環境でも、今回のプレイ中はメモリ上の値で動作を続ける
    }
  }

  let cachedPlayerName = getStoredPlayerName();

  // Supabaseへのリクエストが応答なしのまま固まっても「読み込み中…」が
  // 永久に残らないよう、一定時間で必ずnull（失敗扱い）に解決させるラッパー。
  // fetch自体にはタイムアウトが無いため、Promiseが一生解決しないケース
  // （回線の途中経路で応答が握りつぶされる等）に対する保険として必須。
  const SUPABASE_TIMEOUT_MS = 8000;

  function withTimeout(promise, ms) {
    return new Promise((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        resolve(null);
      }, ms);

      Promise.resolve(promise).then(
        (value) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(value);
        },
        () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(null);
        }
      );
    });
  }

  // leaderboard から生データを取得する。取得失敗・タイムアウト時は
  // null（0件とは区別する）を返す。この関数は例外を投げず、必ずどちらかの
  // 値で解決する（＝呼び出し側が永久に待たされることはない）。
  async function fetchLeaderboardRows() {
    if (!supabaseClient) return null;
    try {
      const result = await withTimeout(
        supabaseClient
          .from(LEADERBOARD_TABLE)
          .select("player_name, best_time")
          .order("best_time", { ascending: false })
          .limit(LEADERBOARD_FETCH_LIMIT),
        SUPABASE_TIMEOUT_MS
      );
      if (result === null) return null; // タイムアウト、またはネットワーク層の失敗
      const { data, error } = result;
      if (error) throw error;
      return data || [];
    } catch (e) {
      return null;
    }
  }

  // 同名の記録は最高記録（best_timeが最大のもの）だけを残し、降順に並べ替える
  function dedupeBestPerPlayer(rows) {
    const bestByName = new Map();
    for (const row of rows) {
      const name = row && row.player_name ? String(row.player_name).trim() : "";
      if (!name) continue;
      const t = Number(row.best_time) || 0;
      const prev = bestByName.get(name);
      if (prev === undefined || t > prev) {
        bestByName.set(name, t);
      }
    }
    return Array.from(bestByName, ([name, best_time]) => ({ name, best_time }))
      .sort((a, b) => b.best_time - a.best_time);
  }

  async function submitScore(name, time) {
    if (!supabaseClient || !name) return;
    try {
      const result = await withTimeout(
        supabaseClient.from(LEADERBOARD_TABLE).insert([{ player_name: name, best_time: time }]),
        SUPABASE_TIMEOUT_MS
      );
      if (result && result.error) throw result.error;
    } catch (e) {
      // 送信に失敗・タイムアウトしてもゲーム進行やゲームオーバー演出には影響させない
    }
  }

  function createRankRow(rank, entry, badgeText) {
    const li = document.createElement("li");
    li.className = "rank-row";
    if (rank <= 3) li.classList.add(`rank-${rank}`);
    if (cachedPlayerName && entry.name === cachedPlayerName) {
      li.classList.add("is-me");
    }

    const badgeEl = document.createElement("span");
    badgeEl.className = "rank-badge";
    badgeEl.textContent = badgeText;

    const nameEl = document.createElement("span");
    nameEl.className = "rank-name";
    nameEl.textContent = entry.name;

    const timeEl = document.createElement("span");
    timeEl.className = "rank-time";
    timeEl.textContent = `${entry.best_time.toFixed(2)}s`;

    li.appendChild(badgeEl);
    li.appendChild(nameEl);
    li.appendChild(timeEl);
    return li;
  }

  async function refreshTop3() {
    top3ListEl.innerHTML = "";
    top3StatusEl.hidden = false;
    top3StatusEl.textContent = "ランキング読み込み中…";

    // fetchLeaderboardRows自体は例外を投げない設計だが、万一ここで
    // 想定外のエラーが起きても「読み込み中…」が残り続けないよう保険をかけておく。
    try {
      const rows = await fetchLeaderboardRows();
      if (rows === null) {
        top3StatusEl.hidden = false;
        top3StatusEl.textContent = "ランキングを取得できませんでした";
        return;
      }

      const ranked = dedupeBestPerPlayer(rows);
      if (ranked.length === 0) {
        top3StatusEl.hidden = false;
        top3StatusEl.textContent = "まだ記録がありません";
        return;
      }

      top3StatusEl.hidden = true;
      ranked.slice(0, 3).forEach((entry, i) => {
        top3ListEl.appendChild(createRankRow(i + 1, entry, MEDAL_BADGES[i]));
      });
    } catch (e) {
      top3StatusEl.hidden = false;
      top3StatusEl.textContent = "ランキングを取得できませんでした";
    }
  }

  async function openRankingPanel() {
    rankingBackdropEl.hidden = false;
    rankingPanelEl.hidden = false;
    void rankingPanelEl.offsetWidth; // reflowを挟んでスライドインアニメーションを確実に再生する
    rankingBackdropEl.classList.add("open");
    rankingPanelEl.classList.add("open");

    rankingFullListEl.innerHTML = "";
    rankingStatusEl.hidden = false;
    rankingStatusEl.textContent = "読み込み中…";

    try {
      const rows = await fetchLeaderboardRows();
      if (rows === null) {
        rankingStatusEl.hidden = false;
        rankingStatusEl.textContent = "ランキングを取得できませんでした";
        return;
      }

      const ranked = dedupeBestPerPlayer(rows);
      if (ranked.length === 0) {
        rankingStatusEl.hidden = false;
        rankingStatusEl.textContent = "まだ記録がありません";
        return;
      }

      rankingStatusEl.hidden = true;
      ranked.forEach((entry, i) => {
        const rank = i + 1;
        const badge = rank <= 3 ? MEDAL_BADGES[rank - 1] : String(rank);
        rankingFullListEl.appendChild(createRankRow(rank, entry, badge));
      });
    } catch (e) {
      rankingStatusEl.hidden = false;
      rankingStatusEl.textContent = "ランキングを取得できませんでした";
    }
  }

  function closeRankingPanel() {
    rankingBackdropEl.classList.remove("open");
    rankingPanelEl.classList.remove("open");
    setTimeout(() => {
      rankingBackdropEl.hidden = true;
      rankingPanelEl.hidden = true;
    }, 320);
  }

  openRankingBtn.addEventListener("click", openRankingPanel);
  rankingCloseBtn.addEventListener("click", closeRankingPanel);
  rankingBackdropEl.addEventListener("click", closeRankingPanel);

  // ---- プレイヤー名入力モーダル（初めてSTARTを押したときだけ表示） ----
  function openNameModal() {
    nameModalBackdropEl.hidden = false;
    nameModalEl.hidden = false;
    nameInputEl.value = "";
    setTimeout(() => nameInputEl.focus(), 50);
  }

  function closeNameModal() {
    nameModalBackdropEl.hidden = true;
    nameModalEl.hidden = true;
  }

  function confirmNameModal() {
    const name = nameInputEl.value.trim().slice(0, 14);
    if (!name) {
      nameInputEl.focus();
      return;
    }
    cachedPlayerName = name;
    storePlayerName(name);
    closeNameModal();
    startGame();
  }

  nameConfirmBtn.addEventListener("click", confirmNameModal);
  nameInputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      confirmNameModal();
    }
  });

  // =========================================================
  // タイトル画面の演出（装飾の「まさよし」・当たり判定なし）
  // =========================================================
  const TITLE_DECO_CONFIG = {
    farCount: 14,
    ringCount: 8,
    fontMin: 16,
    fontMax: 34,
    ringFontMin: 20,
    ringFontMax: 40,
  };

  function createTitleDecoEl({ top, left, fontSize, opacity }) {
    const el = document.createElement("span");
    el.className = "title-deco";
    el.textContent = "まさよし";

    const rot = randRange(-35, 35);
    el.style.setProperty("--tx", `${left}%`);
    el.style.setProperty("--ty", `${top}%`);
    el.style.setProperty("--fs", `${fontSize}px`);
    el.style.setProperty("--rot", `${rot}deg`);
    el.style.setProperty("--op", `${opacity}`);

    const motion = Math.random();
    if (motion < 0.35) {
      el.classList.add("deco-float");
      el.style.setProperty("--dur", `${randRange(2.4, 4.2)}s`);
      el.style.setProperty("--delay", `${randRange(0, 2)}s`);
    } else if (motion < 0.6) {
      el.classList.add("deco-spin");
      el.style.setProperty("--dur", `${randRange(5, 11)}s`);
      el.style.setProperty("--delay", `${randRange(0, 2)}s`);
    }

    return el;
  }

  function renderTitleDecorations() {
    titleDecoBack.innerHTML = "";
    titleDecoFront.innerHTML = "";

    // 画面全体に散らばる背景の「まさよし」
    for (let i = 0; i < TITLE_DECO_CONFIG.farCount; i++) {
      const el = createTitleDecoEl({
        top: randRange(4, 96),
        left: randRange(4, 96),
        fontSize: randRange(TITLE_DECO_CONFIG.fontMin, TITLE_DECO_CONFIG.fontMax),
        opacity: randRange(0.25, 0.6),
      });
      titleDecoBack.appendChild(el);
    }

    // プレイヤーの周りを取り囲む「まさよし」（キャラの手前/奥に半分ずつ配置）
    const anchorTop = 15;
    const anchorLeft = 50;
    for (let i = 0; i < TITLE_DECO_CONFIG.ringCount; i++) {
      const angle = (i / TITLE_DECO_CONFIG.ringCount) * Math.PI * 2 + randRange(-0.3, 0.3);
      const radius = randRange(11, 20);
      const top = anchorTop + Math.sin(angle) * radius * 0.6;
      const left = anchorLeft + Math.cos(angle) * radius;

      const el = createTitleDecoEl({
        top: Math.max(2, Math.min(98, top)),
        left: Math.max(2, Math.min(98, left)),
        fontSize: randRange(TITLE_DECO_CONFIG.ringFontMin, TITLE_DECO_CONFIG.ringFontMax),
        opacity: randRange(0.75, 1),
      });

      if (i % 2 === 0) {
        titleDecoBack.appendChild(el);
      } else {
        titleDecoFront.appendChild(el);
      }
    }
  }

  // =========================================================
  // ゲーム状態
  // =========================================================
  let state = "title"; // "title" | "playing" | "gameover"
  let elapsedTime = 0;
  let spawnAccumulator = 0;
  let rafId = null;
  let lastTs = null;

  // 画像障害物の出現保証まわりの状態
  let firstImageSpawned = false;
  let firstImageForceTime = 0; // 開始から何秒後に最初の画像を強制出現させるか
  let lastImageSpawnTime = 0;  // 最後に画像障害物が出現したゲーム内時刻

  // ゲームオーバー演出のタイマー管理（もう一度／スタートに戻る時にまとめて解除する）
  let gameOverTimeouts = [];

  const player = { x: 0, y: 0 };
  let enemies = [];

  // プレイヤーの見た目の向き・移動アニメーション状態
  let facingRight = false;  // false=左向き（画像そのまま） / true=右向き（左右反転）
  let lastMoveAt = 0;       // 直近に移動入力があった時刻（performance.now()）。走行アニメの停止判定に使用

  function updatePlayerPosition() {
    playerEl.style.left = `${player.x}px`;
    playerEl.style.top = `${player.y}px`;
  }

  function resetPlayer() {
    player.x = gameW / 2;
    player.y = gameH / 2;
    updatePlayerPosition();
  }

  // プレイヤー画像の表示サイズ（幅は固定・高さは画像の縦横比から算出）の半分を返す。
  // 移動範囲のクランプに使用し、見た目のスプライト全体が画面外へ出ないようにする。
  function getPlayerVisualHalfSize() {
    const w = CONFIG.playerVisualWidth;
    const h = playerImageData.ready ? w / playerImageData.ratio : w;
    return { halfW: w / 2, halfH: h / 2 };
  }

  // 当たり判定の中心座標（見た目の中心=player.x/yとは別に、体の中心付近へオフセットする）。
  // 左右反転している場合はオフセットのXも一緒に反転させ、体の位置に追従させる。
  function getPlayerHitboxCenter() {
    const { halfW, halfH } = getPlayerVisualHalfSize();
    const flip = facingRight ? -1 : 1;
    return {
      x: player.x + CONFIG.playerHitboxOffsetXRatio * (halfW * 2) * flip,
      y: player.y + CONFIG.playerHitboxOffsetYRatio * (halfH * 2),
    };
  }

  // =========================================================
  // 入力：キーボード（WASD / 矢印キー）
  // =========================================================
  const pressedKeys = new Set();

  const NAV_KEYS = ["arrowup", "arrowdown", "arrowleft", "arrowright", " "];

  window.addEventListener("keydown", (e) => {
    const key = e.key.toLowerCase();
    pressedKeys.add(key);
    if (state === "playing" && NAV_KEYS.includes(key)) {
      e.preventDefault(); // 矢印キーでのページスクロールを防止
    }
  });
  window.addEventListener("keyup", (e) => {
    pressedKeys.delete(e.key.toLowerCase());
  });

  function getKeyboardDirection() {
    let dx = 0, dy = 0;
    if (pressedKeys.has("a") || pressedKeys.has("arrowleft")) dx -= 1;
    if (pressedKeys.has("d") || pressedKeys.has("arrowright")) dx += 1;
    if (pressedKeys.has("w") || pressedKeys.has("arrowup")) dy -= 1;
    if (pressedKeys.has("s") || pressedKeys.has("arrowdown")) dy += 1;

    if (dx !== 0 && dy !== 0) {
      const inv = 1 / Math.sqrt(2);
      dx *= inv;
      dy *= inv;
    }
    return { dx, dy };
  }

  // =========================================================
  // 入力：タッチ（画面のどこを触ってもOK・相対スライドで移動）
  // 指がキャラクターを隠さないよう、絶対位置ではなく
  // 「スライドした量」だけプレイヤーを動かす相対操作方式。
  // =========================================================
  let lastTouch = null;

  gameContainer.addEventListener("touchstart", (e) => {
    if (state !== "playing") return;
    const t = e.changedTouches[0];
    lastTouch = { x: t.clientX, y: t.clientY };
    e.preventDefault();
  }, { passive: false });

  gameContainer.addEventListener("touchmove", (e) => {
    if (state !== "playing" || !lastTouch) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - lastTouch.x;
    const dy = t.clientY - lastTouch.y;
    lastTouch = { x: t.clientX, y: t.clientY };

    player.x += dx * CONFIG.touchSensitivity;
    player.y += dy * CONFIG.touchSensitivity;
    clampPlayer();
    updatePlayerPosition();

    if (Math.abs(dx) > 1) facingRight = dx > 0;
    lastMoveAt = performance.now();

    e.preventDefault();
  }, { passive: false });

  gameContainer.addEventListener("touchend", (e) => {
    lastTouch = null;
    // ゲームプレイ中の操作用タッチのみ preventDefault する。
    // ここを常に呼ぶと、ゲームオーバー後にボタン上で発生した touchend まで
    // preventDefault されてしまい、スマホでは後続の click が発火せず
    // 「もう一度」「スタートに戻る」が押せなくなる（PCのmouse clickはこの経路を通らないため無症状だった）。
    if (state !== "playing") return;
    e.preventDefault();
  }, { passive: false });

  gameContainer.addEventListener("touchcancel", () => {
    lastTouch = null;
  });

  function clampPlayer() {
    const { halfW, halfH } = getPlayerVisualHalfSize();
    player.x = Math.min(Math.max(player.x, halfW), gameW - halfW);
    player.y = Math.min(Math.max(player.y, halfH), gameH - halfH);
  }

  // =========================================================
  // 難易度カーブ
  // =========================================================
  function getSpawnInterval(t) {
    return Math.max(
      CONFIG.spawnIntervalMin,
      CONFIG.spawnIntervalStart - t * CONFIG.spawnIntervalDecayPerSec
    );
  }

  function getSpeedMultiplier(t) {
    return Math.min(
      CONFIG.speedMultiplierMax,
      1 + t * CONFIG.speedMultiplierGrowPerSec
    );
  }

  function randRange(min, max) {
    return min + Math.random() * (max - min);
  }

  // =========================================================
  // 敵（「まさよし」）の生成・更新
  // =========================================================
  const SIDES = [
    // top -> down
    { spawn: () => ({ x: randRange(0, gameW), y: -CONFIG.enemySpawnMargin }), dir: { x: 0, y: 1 } },
    // right -> left
    { spawn: () => ({ x: gameW + CONFIG.enemySpawnMargin, y: randRange(0, gameH) }), dir: { x: -1, y: 0 } },
    // bottom -> up
    { spawn: () => ({ x: randRange(0, gameW), y: gameH + CONFIG.enemySpawnMargin }), dir: { x: 0, y: -1 } },
    // left -> right
    { spawn: () => ({ x: -CONFIG.enemySpawnMargin, y: randRange(0, gameH) }), dir: { x: 1, y: 0 } },
  ];

  function spawnEnemy() {
    if (enemies.length >= CONFIG.maxEnemies) return;

    const side = SIDES[Math.floor(Math.random() * SIDES.length)];
    const { x, y } = side.spawn();

    // 進行方向にランダムなブレを加える（画面を横切りつつも単調にならないように）
    const deviation = randRange(-CONFIG.enemyDirDeviation, CONFIG.enemyDirDeviation);
    const cos = Math.cos(deviation);
    const sin = Math.sin(deviation);
    const baseDx = side.dir.x;
    const baseDy = side.dir.y;
    const dirX = baseDx * cos - baseDy * sin;
    const dirY = baseDx * sin + baseDy * cos;

    const speedMul = getSpeedMultiplier(elapsedTime);
    const speed = randRange(CONFIG.enemySpeedMin, CONFIG.enemySpeedMax) * speedMul;

    const angle = randRange(0, 360);
    const spin = Math.random() < CONFIG.enemySpinChance;
    const spinSpeed = spin ? randRange(-CONFIG.enemySpinSpeedMax, CONFIG.enemySpinSpeedMax) : 0;

    // 敵の種類を抽選（文字 / 画像1 / 画像2）。画像が未読込の場合は文字にフォールバック。
    let kind = pickEnemyKind();
    let imageData = null;
    if (kind === "image1") imageData = obstacleImages[0];
    if (kind === "image2") imageData = obstacleImages[1];
    if (imageData && !imageData.ready) kind = "text";

    const el = document.createElement("div");
    let halfW, halfH;

    if (kind === "text") {
      const fontSize = randRange(CONFIG.enemyFontMin, CONFIG.enemyFontMax);
      el.className = "enemy";
      el.textContent = CONFIG.enemyText;
      el.style.fontSize = `${fontSize}px`;
      halfW = fontSize * 1.9 * CONFIG.enemyHitboxShrink;
      halfH = fontSize * 0.55 * CONFIG.enemyHitboxShrink;
    } else {
      const isHuge = Math.random() < CONFIG.imageObstacleHugeChance;
      const baseSize = isHuge
        ? randRange(gameW * CONFIG.imageObstacleHugeSizeMinRatio, gameW * CONFIG.imageObstacleHugeSizeMaxRatio)
        : randRange(gameW * CONFIG.imageObstacleSizeMinRatio, gameW * CONFIG.imageObstacleSizeMaxRatio);

      // 元画像の縦横比を維持したまま、長辺が baseSize になるようにする（引き伸ばし防止）
      const ratio = imageData.ratio;
      const boxW = ratio >= 1 ? baseSize : baseSize * ratio;
      const boxH = ratio >= 1 ? baseSize / ratio : baseSize;

      el.className = "enemy enemy-image";
      el.style.backgroundImage = `url("${imageData.src}")`;
      el.style.width = `${boxW}px`;
      el.style.height = `${boxH}px`;
      halfW = (boxW / 2) * CONFIG.imageObstacleHitboxShrink;
      halfH = (boxH / 2) * CONFIG.imageObstacleHitboxShrink;
    }

    gameContainer.appendChild(el);

    if (kind === "image1" || kind === "image2") {
      firstImageSpawned = true;
      lastImageSpawnTime = elapsedTime;
    }

    enemies.push({
      el,
      x, y,
      vx: dirX * speed,
      vy: dirY * speed,
      angle,
      spin,
      spinSpeed,
      halfW,
      halfH,
    });
  }

  function pickEnemyKind() {
    // 1) 開始から7〜10秒以内に最初の画像障害物を必ず1回出す
    //    （それより前に通常抽選で画像が出ていれば firstImageSpawned が true になり自動的にキャンセルされる）
    if (!firstImageSpawned && elapsedTime >= firstImageForceTime) {
      return Math.random() < 0.5 ? "image1" : "image2";
    }

    // 2) 画像障害物が長時間出ていない場合は次を必ず画像にする
    if (elapsedTime - lastImageSpawnTime >= CONFIG.imageForceGapSeconds) {
      return Math.random() < 0.5 ? "image1" : "image2";
    }

    // 3) 通常の抽選（文字60% / 画像1 20% / 画像2 20%）
    const r = Math.random();
    if (r < CONFIG.enemyTextRatio) return "text";
    if (r < CONFIG.enemyTextRatio + CONFIG.enemyImage1Ratio) return "image1";
    return "image2";
  }

  function updateEnemies(dt) {
    const margin = CONFIG.enemySpawnMargin + 40;

    for (let i = enemies.length - 1; i >= 0; i--) {
      const en = enemies[i];
      en.x += en.vx * dt;
      en.y += en.vy * dt;
      if (en.spin) {
        en.angle += en.spinSpeed * dt;
      }

      en.el.style.transform = `translate(-50%, -50%) rotate(${en.angle}deg)`;
      en.el.style.left = `${en.x}px`;
      en.el.style.top = `${en.y}px`;

      const outOfBounds =
        en.x < -margin - en.halfW ||
        en.x > gameW + margin + en.halfW ||
        en.y < -margin - en.halfH ||
        en.y > gameH + margin + en.halfH;

      if (outOfBounds) {
        en.el.remove();
        enemies.splice(i, 1);
        continue;
      }

      if (checkCollision(en)) {
        triggerGameOver();
        return;
      }
    }
  }

  // 回転した矩形（敵）とプレイヤーの当たり判定円の当たり判定
  // 判定円はプレイヤー画像の中心ではなく、体の中心付近（getPlayerHitboxCenter）を使う
  function checkCollision(en) {
    const hitbox = getPlayerHitboxCenter();

    const rad = (en.angle * Math.PI) / 180;
    const cos = Math.cos(-rad);
    const sin = Math.sin(-rad);

    const dx = hitbox.x - en.x;
    const dy = hitbox.y - en.y;

    const localX = dx * cos - dy * sin;
    const localY = dx * sin + dy * cos;

    const closestX = Math.min(Math.max(localX, -en.halfW), en.halfW);
    const closestY = Math.min(Math.max(localY, -en.halfH), en.halfH);

    const distX = localX - closestX;
    const distY = localY - closestY;

    return (distX * distX + distY * distY) < (CONFIG.playerHitboxRadius * CONFIG.playerHitboxRadius);
  }

  function clearEnemies() {
    for (const en of enemies) {
      en.el.remove();
    }
    enemies = [];
  }

  // =========================================================
  // メインループ
  // =========================================================
  function frame(ts) {
    if (state !== "playing") return;

    if (lastTs === null) lastTs = ts;
    let dt = (ts - lastTs) / 1000;
    lastTs = ts;
    dt = Math.min(dt, 0.05); // タブ切替後の巨大なdt対策

    elapsedTime += dt;
    timerEl.textContent = `${elapsedTime.toFixed(2)}s`;

    // キーボード移動
    const { dx, dy } = getKeyboardDirection();
    if (dx !== 0 || dy !== 0) {
      player.x += dx * CONFIG.keyboardSpeed * dt;
      player.y += dy * CONFIG.keyboardSpeed * dt;
      clampPlayer();
      updatePlayerPosition();

      if (dx !== 0) facingRight = dx > 0;
      lastMoveAt = performance.now();
    }

    // 向き・走行アニメーションの見た目を反映（キーボード／タッチどちらの入力でも共通で毎フレーム適用）
    const isMoving = performance.now() - lastMoveAt < CONFIG.playerMoveIdleMs;
    playerBobEl.classList.toggle("running", isMoving);
    playerSpriteEl.classList.toggle("face-right", facingRight);

    // 敵のスポーン
    spawnAccumulator += dt;
    const interval = getSpawnInterval(elapsedTime);
    let safety = 0;
    while (spawnAccumulator >= interval && safety < 10) {
      spawnEnemy();
      spawnAccumulator -= interval;
      safety++;
    }

    updateEnemies(dt);

    if (state === "playing") {
      rafId = requestAnimationFrame(frame);
    }
  }

  // =========================================================
  // ゲーム開始・終了・リスタート
  // =========================================================
  function startGame() {
    titleScreen.hidden = true;
    resetGameOverSequence();
    gameContainer.hidden = false;

    resizeGameContainer();
    resetPlayer();
    clearEnemies();

    elapsedTime = 0;
    spawnAccumulator = 0;
    lastTs = null;
    timerEl.textContent = "0.00s";

    firstImageSpawned = false;
    firstImageForceTime = randRange(CONFIG.firstImageForceMin, CONFIG.firstImageForceMax);
    lastImageSpawnTime = 0;

    facingRight = false;
    lastMoveAt = 0;
    playerBobEl.classList.remove("running");
    playerSpriteEl.classList.remove("face-right");

    state = "playing";
    rafId = requestAnimationFrame(frame);
  }

  // ゲームオーバー演出用のタイマーを解除しつつ、演出の見た目を初期状態へ戻す。
  // 「もう一度」「スタートに戻る」で必ず呼び、次回の演出をまっさらな状態から開始できるようにする。
  function resetGameOverSequence() {
    gameOverTimeouts.forEach(clearTimeout);
    gameOverTimeouts = [];

    gameContainer.classList.remove("screen-shake");
    gameoverFlashEl.classList.remove("flash-active");

    gameoverOverlayEl.hidden = true;

    gameoverImageEl.classList.remove("image-pop");
    gameoverDonEl.classList.remove("don-pop");
    gameoverTauntEl.classList.remove("taunt-pop");
    gameoverTauntEl.textContent = "";

    gameoverActionsEl.classList.remove("show");
    gameoverActionsEl.hidden = true;
  }

  function scheduleGameOverTimeout(fn, delay) {
    const id = setTimeout(fn, delay);
    gameOverTimeouts.push(id);
    return id;
  }

  function triggerGameOver() {
    if (state !== "playing") return;
    state = "gameover";
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
    lastTouch = null;

    playHitSound();
    resetGameOverSequence();

    // 生存時間をランキングへ送信（失敗しても演出・ゲーム進行には影響しない）
    if (cachedPlayerName) {
      submitScore(cachedPlayerName, elapsedTime);
    }

    // 1. 画面を一瞬強く揺らす
    gameContainer.classList.add("screen-shake");
    scheduleGameOverTimeout(() => {
      gameContainer.classList.remove("screen-shake");
    }, CONFIG.gameOverShakeMs);

    // 2. 画面を白くフラッシュ（0.1〜0.2秒）
    gameoverFlashEl.classList.add("flash-active");
    scheduleGameOverTimeout(() => {
      gameoverFlashEl.classList.remove("flash-active");
    }, CONFIG.gameOverFlashMs);

    gameoverOverlayEl.hidden = false;

    // 3〜6. 白フラッシュの直後、gameover.jpeg と「ドン！！」を同時に登場させる
    //       （画像はオーバーシュートしながら画面いっぱい近くまで拡大）
    scheduleGameOverTimeout(() => {
      gameoverImageEl.classList.add("image-pop");
      gameoverDonEl.classList.add("don-pop");

      // 「ドン！！」は一瞬だけ表示して消す
      scheduleGameOverTimeout(() => {
        gameoverDonEl.classList.remove("don-pop");
      }, CONFIG.gameOverDonVisibleMs);

      // 画像出現の約0.3秒後に煽り文句を表示（以後はゲームオーバー画面中ずっと表示し続ける）
      scheduleGameOverTimeout(() => {
        const taunts = CONFIG.gameOverTaunts;
        gameoverTauntEl.textContent = taunts[Math.floor(Math.random() * taunts.length)];
        gameoverTauntEl.classList.add("taunt-pop");
      }, CONFIG.gameOverTauntDelayMs);
    }, CONFIG.gameOverImageAppearMs);

    // 7. 接触から約3秒後に生存時間とボタン群を下からフェードインで表示
    scheduleGameOverTimeout(() => {
      survivedTimeEl.textContent = `生存時間: ${elapsedTime.toFixed(2)}秒`;
      gameoverActionsEl.hidden = false;
      void gameoverActionsEl.offsetWidth; // reflow を挟んでアニメーションを確実に再生する
      gameoverActionsEl.classList.add("show");
    }, CONFIG.gameOverActionsDelayMs);
  }

  // タイトル画面に戻る（ページ再読み込みはせず、状態のみ初期化する）
  function returnToTitle() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
    lastTs = null;
    lastTouch = null;
    pressedKeys.clear();

    state = "title";
    elapsedTime = 0;
    spawnAccumulator = 0;
    timerEl.textContent = "0.00s";

    clearEnemies();
    resetPlayer();
    resetGameOverSequence();

    facingRight = false;
    lastMoveAt = 0;
    playerBobEl.classList.remove("running");
    playerSpriteEl.classList.remove("face-right");

    gameContainer.hidden = true;
    titleScreen.hidden = false;

    refreshTop3(); // 今回の記録が反映されるよう、タイトルに戻るたびにランキングを取り直す
  }

  startBtn.addEventListener("click", () => {
    // 押した瞬間に少し潰れるアニメーションを見せてから開始する
    startBtn.classList.remove("squish");
    void startBtn.offsetWidth; // reflow を挟んでアニメーションを再トリガーする
    startBtn.classList.add("squish");
    setTimeout(() => {
      startBtn.classList.remove("squish");
      // 初めてSTARTを押したときだけ名前入力を挟む。以後はlocalStorageの名前でそのまま開始する。
      if (!cachedPlayerName) {
        openNameModal();
      } else {
        startGame();
      }
    }, 260);
  });
  retryBtn.addEventListener("click", startGame);
  backToTitleBtn.addEventListener("click", returnToTitle);

  window.addEventListener("resize", resizeGameContainer);
  window.addEventListener("orientationchange", resizeGameContainer);
  // モバイルSafari等でアドレスバーの表示/非表示だけが起きた場合に備え、
  // 対応ブラウザでは visualViewport の resize も拾ってサイズを追従させる。
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", resizeGameContainer);
  }

  // 初期表示サイズとタイトル演出を準備しておく
  resizeGameContainer();
  renderTitleDecorations();
  refreshTop3();
})();
