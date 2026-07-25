import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import {
  advertisingMaterialFormats,
  advertisingMaterialPdfFromJpeg,
  advertisingMaterialSvg,
} from '../apps/api/src/advertising-materials.js';

const project = {
  id: 'b26cc87e-9dbf-4bc1-afca-5c3578732d70',
  format_preset: 'a5',
  orientation: 'portrait',
  material_kind: 'flyer',
  visual_style: 'broadcast',
  background_mode: 'gradient',
  primary_color: '#07111f',
  accent_color: '#22d3ee',
  text_color: '#f8fafc',
  advertiser: 'Zeitkante',
  campaign_name: 'Senderkampagne',
  headline: 'Ein <starkes> Motiv & eine klare Botschaft',
  body: 'Ein druckfertiger Testtext für das Werbematerial.',
  call_to_action: 'Jetzt ansehen',
  website: 'zeitkante.de',
};

describe('Werbematerial-Renderer', () => {
  it('liefert echte 300-DPI-Druckformate und entschärft SVG-Inhalte', () => {
    expect(advertisingMaterialFormats.a5).toEqual({
      label: 'A5 Flyer',
      width: 1748,
      height: 2480,
      dpi: 300,
    });
    const svg = advertisingMaterialSvg(project);
    expect(svg).toContain('width="1748"');
    expect(svg).toContain('Ein &lt;starkes&gt; Motiv &amp;');
    expect(svg).not.toContain('Ein <starkes>');
  });

  it('verpackt den gerenderten Druck in eine valide einseitige PDF-Datei', async () => {
    const jpeg = await sharp({
      create: { width: 24, height: 32, channels: 3, background: '#07111f' },
    })
      .jpeg()
      .toBuffer();
    const pdf = advertisingMaterialPdfFromJpeg(jpeg, 1748, 2480, 300);
    expect(pdf.subarray(0, 8).toString('ascii')).toBe('%PDF-1.4');
    expect(pdf.toString('latin1')).toContain('/Subtype /Image');
    expect(pdf.toString('latin1')).toContain('%%EOF');
  });
});
