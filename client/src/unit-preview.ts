import Phaser from 'phaser';
import { REDESIGNED_UNIT_TYPES, UNIT_PREVIEW_LABELS, createUnitArt } from './game/rendering/unitArt';

const PREVIEW_COLORS: Record<string, number> = {
  soldier: 0xd97706,
  tank: 0x2dd4bf,
  humvee: 0xf97316,
  oil_seeker: 0x60a5fa,
  missile_launcher: 0xef4444,
  destroyer: 0x38bdf8,
  pirate_ship: 0xf59e0b,
  construction_ship: 0xf59e0b,
  sniper: 0x84cc16,
  rocketeer: 0xa78bfa,
  ferry: 0x14b8a6,
  builder: 0xf43f5e,
  light_plane: 0x0ea5e9,
  heavy_plane: 0x6366f1
};

function getPreviewScale(type: string) {
  if (type === 'destroyer' || type === 'pirate_ship' || type === 'construction_ship' || type === 'ferry') return 1.15;
  if (type === 'heavy_plane') return 1.1;
  return 1.2;
}

class UnitPreviewScene extends Phaser.Scene {
  constructor() {
    super('UnitPreviewScene');
  }

  create() {
    const width = this.scale.width;
    const height = this.scale.height;
    this.cameras.main.setBackgroundColor('#08131b');

    const background = this.add.graphics();
    for (let i = 0; i < 12; i++) {
      const ratio = i / 11;
      const color = Phaser.Display.Color.Interpolate.ColorWithColor(
        Phaser.Display.Color.ValueToColor(0x08131b),
        Phaser.Display.Color.ValueToColor(0x18354a),
        11,
        i
      );
      background.fillStyle(Phaser.Display.Color.GetColor(color.r, color.g, color.b), 1);
      background.fillRect(0, height * ratio, width, height / 11 + 2);
    }

    background.fillStyle(0xffffff, 0.035);
    for (let i = 0; i < 14; i++) {
      const bandY = 110 + i * 52;
      background.fillRect(0, bandY, width, 2);
    }

    const title = this.add.text(width / 2, 42, 'Unit Redesign Preview', {
      fontFamily: 'Georgia, serif',
      fontSize: '34px',
      color: '#f6efe0'
    });
    title.setOrigin(0.5);

    const subtitle = this.add.text(
      width / 2,
      82,
      'Updated silhouettes with movement and aim-facing support. Mothership and aircraft carrier intentionally left unchanged.',
      {
        fontFamily: 'Trebuchet MS, sans-serif',
        fontSize: '14px',
        color: '#c8d7e4'
      }
    );
    subtitle.setOrigin(0.5);

    const cols = 4;
    const cardWidth = 255;
    const cardHeight = 155;
    const gapX = 30;
    const gapY = 24;
    const rows = Math.ceil(REDESIGNED_UNIT_TYPES.length / cols);
    const totalWidth = cols * cardWidth + (cols - 1) * gapX;
    const totalHeight = rows * cardHeight + (rows - 1) * gapY;
    const startX = (width - totalWidth) / 2 + cardWidth / 2;
    const startY = 150 + (height - 180 - totalHeight) / 2 + cardHeight / 2;

    REDESIGNED_UNIT_TYPES.forEach((type, index) => {
      const col = index % cols;
      const row = Math.floor(index / cols);
      const x = startX + col * (cardWidth + gapX);
      const y = startY + row * (cardHeight + gapY);
      const accent = PREVIEW_COLORS[type] ?? 0x8b5cf6;

      const card = this.add.container(x, y);
      const panel = this.add.graphics();
      panel.fillStyle(0x0d1f2b, 0.86);
      panel.fillRoundedRect(-cardWidth / 2, -cardHeight / 2, cardWidth, cardHeight, 18);
      panel.lineStyle(2, accent, 0.95);
      panel.strokeRoundedRect(-cardWidth / 2, -cardHeight / 2, cardWidth, cardHeight, 18);
      panel.lineStyle(1, 0xffffff, 0.08);
      panel.strokeRoundedRect(-cardWidth / 2 + 8, -cardHeight / 2 + 8, cardWidth - 16, cardHeight - 16, 14);

      const chip = this.add.graphics();
      chip.fillStyle(accent, 1);
      chip.fillRoundedRect(-cardWidth / 2 + 14, -cardHeight / 2 + 14, 52, 22, 11);

      const chipText = this.add.text(-cardWidth / 2 + 40, -cardHeight / 2 + 25, `${index + 1}`.padStart(2, '0'), {
        fontFamily: 'Trebuchet MS, sans-serif',
        fontSize: '12px',
        color: '#08131b'
      });
      chipText.setOrigin(0.5);

      const art = createUnitArt(this, 0, -6, type, accent, false);
      art.setScale(getPreviewScale(type));

      const name = this.add.text(0, cardHeight / 2 - 34, UNIT_PREVIEW_LABELS[type], {
        fontFamily: 'Georgia, serif',
        fontSize: '20px',
        color: '#f6efe0'
      });
      name.setOrigin(0.5);

      const role = this.add.text(0, cardHeight / 2 - 14, type.replaceAll('_', ' ').toUpperCase(), {
        fontFamily: 'Trebuchet MS, sans-serif',
        fontSize: '11px',
        color: '#9ec1d8',
        letterSpacing: 1
      });
      role.setOrigin(0.5);

      card.add([panel, chip, chipText, art, name, role]);

      this.tweens.add({
        targets: art,
        y: art.y - 3,
        duration: 1200 + row * 140 + col * 90,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut'
      });
    });
  }
}

new Phaser.Game({
  type: Phaser.AUTO,
  width: 1200,
  height: 1020,
  backgroundColor: '#08131b',
  parent: 'app',
  scene: [UnitPreviewScene]
});
