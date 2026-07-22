import { z } from 'zod';

const color = z.string().regex(/^#[0-9a-f]{6}$/i, 'Bitte eine sechsstellige Hex-Farbe auswählen.');
const geometry = {
  visible: z.boolean(),
  x: z.number().int().min(0).max(1080),
  y: z.number().int().min(0).max(1920),
  width: z.number().int().min(40).max(1080),
  height: z.number().int().min(30).max(1920),
};

const mediaElement = z
  .object({
    ...geometry,
    fit: z.enum(['contain', 'cover']),
    borderWidth: z.number().int().min(0).max(16),
  })
  .strict();

const textElement = z
  .object({
    ...geometry,
    fontFamily: z.enum(['dejavu-sans', 'ibm-plex-sans', 'ibm-plex-condensed', 'liberation-sans', 'nimbus-sans']),
    fontSize: z.number().int().min(16).max(112),
    fontWeight: z.enum(['regular', 'semibold', 'bold']),
    color,
    align: z.enum(['left', 'center', 'right']),
    background: z.enum(['none', 'glass', 'solid']),
    text: z.string().trim().max(80).optional(),
  })
  .strict();

export const shortsLayoutSchema = z
  .object({
    version: z.literal(1),
    backgroundStyle: z.enum(['blur', 'studio', 'clean']),
    accentColor: color,
    brandingOverlayVisible: z.boolean(),
    elements: z
      .object({
        sourceVideo: mediaElement,
        avatar: mediaElement,
        formatLabel: textElement,
        title: textElement,
        commentary: textElement,
        source: textElement,
      })
      .strict(),
  })
  .strict();
