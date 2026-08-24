export { BroadcastCard, type BroadcastCardData } from "./broadcast-card";
export {
  URGENT_BROADCAST_COPY,
  UrgentBroadcastCard,
  type UrgentBroadcastCardData,
} from "./urgent-broadcast-card";
export {
  NotificationItem,
  type NotificationItemData,
} from "./notification-item";
export { CriticalNotification } from "./critical-notification";
export { CategoryIcon } from "./category-icon";
// Sólo el componente: `INBOX_PANEL_ID` e `inboxTabId` son de
// `@/lib/notifications/href`. Reexportarlos desde acá volvía a esconder que el
// origen es un archivo `"use client"` — que es exactamente cómo se coló el bug.
export { CategoryTabs, type CategoryTabsProps } from "./category-tabs";
export { InboxFilters } from "./inbox-filters";
export { PrefRow } from "./pref-row";
export { MarkAllRead } from "./mark-all-read";
export { NotificationMenu } from "./notification-menu";
export { NotificationBell } from "./notification-bell";
export { COPY as notificationsCopy, PREFS_COPY } from "./copy";
