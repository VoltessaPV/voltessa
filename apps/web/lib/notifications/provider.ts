/**
 * The generic notification-provider abstraction (Notification Provider
 * milestone, first implementation: NtfyNotificationProvider). Every
 * channel - ntfy today, Email/WhatsApp/SMS later - implements this same
 * interface, so callers (see lib/notifications/automation-notifications.ts)
 * never know which concrete channel(s) are active. Adding a new channel
 * means adding a new file under lib/notifications/providers/ and listing
 * it alongside the existing ones - never changing a caller.
 */

export type NotificationPriority = "default" | "high";

/**
 * Channel-agnostic notification content. Not every provider will use every
 * field the same way (e.g. Email has no real "priority" header the way
 * ntfy does) - each provider decides how to map these onto its own
 * transport.
 */
export type Notification = {
  title: string;
  body: string;
  priority: NotificationPriority;
  tags: string[];
};

export type NotificationProvider = {
  /** Short, stable label for logging - e.g. "ntfy". */
  name: string;
  send(notification: Notification): Promise<void>;
};
