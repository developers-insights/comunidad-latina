export { AcceptBanner } from "./accept-banner";
export { Composer } from "./composer";
export { ConversationActions } from "./conversation-actions";
export { COPY } from "./copy";
// Grupos de chat (0133) + bandeja por persona (0134).
export { GroupCard } from "./group-card";
export { GroupComposer } from "./group-composer";
export { GroupForm, type GrupoEditable } from "./group-form";
export { GroupJoinButton } from "./group-join-button";
export { GroupLive } from "./group-live";
export {
  GroupDangerActions,
  GroupInvite,
  GroupMemberList,
  type MiembroVisible,
} from "./group-manage";
export { GroupMessageBubble, type GroupMessageMensaje } from "./group-message-bubble";
export { InboxRowLink } from "./inbox-row-link";
export { InboxSearch } from "./inbox-search";
/**
 * ⚠️ `InboxTabs`, `InboxRow` y `InboxFiltros` NO se exportan desde acá, y sacarlos
 * costó un build roto: este barril no lleva directiva, pero lo importan client
 * components (`listings/contact-cta.tsx` → `feed/post-card.tsx` → el layout), así
 * que TODO lo que se re-exporte entra al grafo del cliente. `InboxTabs` consulta
 * la base, y con esa línea acá el bundle del navegador terminaba pidiendo
 * `next/headers`:
 *
 *   You're importing a module that depends on "next/headers". This API is only
 *   available in Server Components in the App Router…
 *
 * Se importan por ruta directa desde las páginas, que son Server Components. La
 * regla para lo que venga: si el módulo toca Supabase, `server-only` o
 * `next/headers`, no entra a este archivo.
 */
export { PeopleSearch, type PersonaEncontrada } from "./people-search";
export {
  ContactDone,
  InlineContact,
  listingMessageOutcome,
  type ContactDoneProps,
  type InlineContactCopy,
  type InlineContactOutcome,
  type InlineContactProps,
  type ListingMessageErrorCopy,
} from "./inline-contact";
export { MessageBubble, type MessageBubbleAcciones } from "./message-bubble";
/**
 * Acciones sobre UN mensaje (0136 + 0138): toque largo, barra de reacciones,
 * menú de seis, cita de respuesta y lápida. `ACCIONES_COPY` se funde adentro de
 * `COPY` cuando cierre la tanda — ver la cabecera de copy-acciones.ts.
 */
export { ACCIONES_COPY } from "./copy-acciones";
export { MessageActions, MessageMenu, type MessageActionsProps, type MessageMenuProps } from "./message-menu";
export {
  MessageReactions,
  ReaccionesProvider,
  useReaccionesDelMensaje,
  type ReaccionesProviderProps,
} from "./message-reactions";
export { ReactionBar } from "./reaction-bar";
export {
  ComposerReplyBar,
  ReplyQuote,
  ResponderProvider,
  anclaDeMensaje,
  irAlMensaje,
  resumenDeMensaje,
  useResponder,
  type MensajeCitado,
} from "./reply-quote";
export { ScrollAnchor } from "./scroll-anchor";
export { ThreadHeader, type ThreadHeaderProps } from "./thread-header";
export {
  ThreadListingCard,
  type ThreadListingCardProps,
} from "./thread-listing-card";
export { ThreadRefresh } from "./thread-refresh";
export { toTrustLevel, toTrustProps, buildTrustSignals } from "./trust";
