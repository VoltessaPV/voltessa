import type { Notification, NotificationProvider } from "../provider";

/**
 * ntfy's simple HTTP publish API: POSTing to a topic URL publishes to it -
 * the same URL a subscriber views/subscribes at. No API key, no signup, no
 * additional npm package - native fetch() only, per this milestone's
 * explicit requirement.
 */
const NTFY_TOPIC_URL = "https://ntfy.sh/voltessa-skostov";

/**
 * ntfy reads plain, human-named headers (Title/Priority/Tags - it also
 * accepts an X- prefixed form, but the plain form is what ntfy's own docs
 * lead with). `Tags` is a comma-separated list of ntfy's own emoji-shortcode
 * vocabulary (e.g. "warning", "green_circle") - see
 * https://docs.ntfy.sh/publish/#tags-emojis.
 */
export const ntfyNotificationProvider: NotificationProvider = {
  name: "ntfy",

  async send(notification: Notification): Promise<void> {
    const response = await fetch(NTFY_TOPIC_URL, {
      method: "POST",
      headers: {
        Title: notification.title,
        Priority: notification.priority,
        Tags: notification.tags.join(","),
      },
      body: notification.body,
    });

    if (!response.ok) {
      throw new Error(`ntfy responded with HTTP ${response.status}`);
    }
  },
};
