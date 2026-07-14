import * as Phaser from 'phaser';
import { AUTO, Game } from 'phaser';
import { WorldScene } from './scenes/WorldScene';
import { PlayScene } from './scenes/PlayScene';
import { BuildScene } from './scenes/BuildScene';
import { WORLD_W, WORLD_H } from '../shared/physics';

const config: Phaser.Types.Core.GameConfig = {
  type: AUTO,
  parent: 'game-container',
  backgroundColor: '#24541f',
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: WORLD_W,
    height: WORLD_H,
  },
  scene: [WorldScene, PlayScene, BuildScene],
};

document.addEventListener('DOMContentLoaded', () => {
  new Game(config);
});
