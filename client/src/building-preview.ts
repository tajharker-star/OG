import Phaser from 'phaser';
import type { Building } from './types/game';
import { BUILDING_PREVIEW_LABELS, BUILDING_PREVIEW_TYPES, createBuildingArt } from './game/rendering/buildingArt';

const PREVIEW_COLORS: Record<Building['type'], number> = {
  base: 0xf97316,
  barracks: 0xef4444,
  tank_factory: 0x84cc16,
  air_base: 0x0ea5e9,
  dock: 0x14b8a6,
  tower: 0x94a3b8,
  mine: 0xfacc15,
  oil_rig: 0xfb923c,
  oil_well: 0x38bdf8,
  farm: 0x4ade80,
  wall: 0x9ca3af,
  bridge_node: 0xc084fc,
  wall_node: 0xe5e7eb
};

function getRecruitmentPreview(type: Building['type'], index: number) {
  switch (type) {
    case 'base':
      return [{ unitType: 'builder', progress: 18 + index * 5, totalTime: 45 }];
    case 'barracks':
      return [{ unitType: index % 2 === 0 ? 'soldier' : 'sniper', progress: 24 + index * 6, totalTime: 60 }];
    case 'tank_factory':
      return [{ unitType: index % 2 === 0 ? 'tank' : 'humvee', progress: 52 + index * 7, totalTime: 120 }];
    case 'air_base':
      return [{ unitType: index % 2 === 0 ? 'light_plane' : 'heavy_plane', progress: 48 + index * 8, totalTime: 140 }];
    case 'dock':
      return [{ unitType: index % 2 === 0 ? 'destroyer' : 'ferry', progress: 40 + index * 7, totalTime: 110 }];
    default:
      return [];
  }
}

function createPreviewBuilding(type: Building['type'], index: number): Building {
  return {
    id: `preview_${type}`,
    type,
    level: 1,
    health: 500,
    maxHealth: 500,
    ownerId: 'preview',
    hasTesla: type === 'base',
    recruitmentQueue: getRecruitmentPreview(type, index)
  };
}

class BuildingPreviewScene extends Phaser.Scene {
  constructor() {
    super('BuildingPreviewScene');
  }

  create() {
    const width = this.scale.width;
    const height = this.scale.height;
    this.cameras.main.setBackgroundColor('#09131a');

    const background = this.add.graphics();
    for (let i = 0; i < 14; i++) {
      const color = Phaser.Display.Color.Interpolate.ColorWithColor(
        Phaser.Display.Color.ValueToColor(0x09131a),
        Phaser.Display.Color.ValueToColor(0x1c3647),
        13,
        i
      );
      background.fillStyle(Phaser.Display.Color.GetColor(color.r, color.g, color.b), 1);
      background.fillRect(0, (height / 14) * i, width, height / 14 + 2);
    }

    background.lineStyle(1, 0xffffff, 0.04);
    for (let x = 0; x < width; x += 56) {
      background.lineBetween(x, 120, x, height);
    }
    for (let y = 120; y < height; y += 56) {
      background.lineBetween(0, y, width, y);
    }

    const title = this.add.text(width / 2, 38, 'Building Redesign Preview', {
      fontFamily: 'Georgia, serif',
      fontSize: '34px',
      color: '#f4ead8'
    });
    title.setOrigin(0.5);

    const subtitle = this.add.text(
      width / 2,
      78,
      'Rebuilt silhouettes plus restrained recruitment effects. Active queue animation is shown on recruitable structures.',
      {
        fontFamily: 'Trebuchet MS, sans-serif',
        fontSize: '14px',
        color: '#c4d4df'
      }
    );
    subtitle.setOrigin(0.5);

    const cols = 4;
    const cardWidth = 270;
    const cardHeight = 170;
    const gapX = 26;
    const gapY = 24;
    const totalWidth = cols * cardWidth + (cols - 1) * gapX;
    const startX = (width - totalWidth) / 2 + cardWidth / 2;
    const startY = 182;

    BUILDING_PREVIEW_TYPES.forEach((type, index) => {
      const col = index % cols;
      const row = Math.floor(index / cols);
      const x = startX + col * (cardWidth + gapX);
      const y = startY + row * (cardHeight + gapY);
      const accent = PREVIEW_COLORS[type];
      const building = createPreviewBuilding(type, index);
      const isRecruiting = (building.recruitmentQueue?.length || 0) > 0;

      const card = this.add.container(x, y);
      const panel = this.add.graphics();
      panel.fillStyle(0x0c1f29, 0.9);
      panel.fillRoundedRect(-cardWidth / 2, -cardHeight / 2, cardWidth, cardHeight, 18);
      panel.lineStyle(2, accent, 0.95);
      panel.strokeRoundedRect(-cardWidth / 2, -cardHeight / 2, cardWidth, cardHeight, 18);
      panel.lineStyle(1, 0xffffff, 0.08);
      panel.strokeRoundedRect(-cardWidth / 2 + 8, -cardHeight / 2 + 8, cardWidth - 16, cardHeight - 16, 14);

      const chip = this.add.graphics();
      chip.fillStyle(isRecruiting ? accent : 0x223848, 1);
      chip.fillRoundedRect(-cardWidth / 2 + 14, -cardHeight / 2 + 14, isRecruiting ? 92 : 72, 24, 12);

      const chipText = this.add.text(-cardWidth / 2 + (isRecruiting ? 60 : 50), -cardHeight / 2 + 26, isRecruiting ? 'RECRUITING' : 'STATIC', {
        fontFamily: 'Trebuchet MS, sans-serif',
        fontSize: '11px',
        color: isRecruiting ? '#09131a' : '#d7e7f1'
      });
      chipText.setOrigin(0.5);

      const art = createBuildingArt(this, 0, -8, type, accent, building);
      art.setScale(type === 'wall' ? 1.2 : 1.1);

      const name = this.add.text(0, cardHeight / 2 - 36, BUILDING_PREVIEW_LABELS[type], {
        fontFamily: 'Georgia, serif',
        fontSize: '20px',
        color: '#f4ead8'
      });
      name.setOrigin(0.5);

      const role = this.add.text(0, cardHeight / 2 - 15, type.replaceAll('_', ' ').toUpperCase(), {
        fontFamily: 'Trebuchet MS, sans-serif',
        fontSize: '11px',
        color: '#9cc4da',
        letterSpacing: 1
      });
      role.setOrigin(0.5);

      card.add([panel, chip, chipText, art, name, role]);

      this.tweens.add({
        targets: art,
        y: art.y - 3,
        duration: 1200 + row * 120 + col * 80,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut'
      });
    });
  }
}

new Phaser.Game({
  type: Phaser.AUTO,
  width: 1240,
  height: 1120,
  backgroundColor: '#09131a',
  parent: 'app',
  scene: [BuildingPreviewScene]
});
