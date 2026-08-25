このフォルダに以下のファイルを配置し、script.js 冒頭の ASSETS を書き換えると
実素材に差し替わります。

- player.png      : プレイヤーキャラクター画像（正方形推奨・背景透過PNG）
- gameover.png     : ゲームオーバー時に画面いっぱいに表示する画像
- hit.mp3          : 「まさよし」に接触した瞬間に鳴らす効果音

例:
  const ASSETS = {
    playerImage: "assets/player.png",
    gameOverImage: "assets/gameover.png",
    hitSound: "assets/hit.mp3",
  };
