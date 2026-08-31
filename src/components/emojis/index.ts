/**
 * EMOJIS PROPIOS DE LA COMUNIDAD (migración 0125).
 *
 * Una sola puerta de entrada para las tres superficies:
 *
 *   · COMENTARIOS  → `EmojiPickerPopover` para elegir, `CommunityEmojiText`
 *                    para pintar el `:slug:` que quedó en el cuerpo.
 *   · EDITOR DE FOTOS → `EmojiPicker` inline; el dibujo se pega sobre la foto y
 *                    lo quema `bake-photo.ts`.
 *   · REACCIONES   → `EmojiPickerPopover` + `CommunityEmojiImage`, pendiente de
 *                    enchufar (ver el informe de entrega).
 */
export { EmojiPicker, type EmojiPickerProps, type UnicodeEmojiGroup } from "./emoji-picker";
export { EmojiPickerPopover } from "./emoji-picker-popover";
export { CommunityEmojiImage } from "./community-emoji-image";
export { CommunityEmojiText } from "./community-emoji-text";
export { EMOJI_COPY } from "./copy";
