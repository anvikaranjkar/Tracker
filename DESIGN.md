# Show Up design notes

The layout keeps Show Up’s paper background, cobalt controls, Instrument Sans and IBM Plex Mono. The Today screen starts with the date and the user’s check-ins. The group panel shows attendance and a small roster. The full roster lives with the agreement, where every member can review the terms and their own goal.

## Mobile and installation

The mobile header includes the inbox, the bottom navigation accounts for the home indicator and landscape content respects left and right safe areas. Form inputs use 16 px text, and information icons have 44 px touch targets. Tooltips stay open while hovered, work with keyboard focus and tap, and close with Escape. [WebKit’s safe-area guidance](https://webkit.org/blog/7929/designing-websites-for-iphone-x/) · [WCAG 2.2 hover and focus guidance](https://www.w3.org/WAI/WCAG22/Understanding/content-on-hover-or-focus.html)

The manifest uses a stable app ID, a standalone launch, standard and maskable icons, an Apple touch icon and an Inbox shortcut. Install help follows the device’s menu. Fonts are hosted with the app. The service worker precaches versioned public files, uses the network for navigation and displays a local reconnect screen if needed. Account responses are network-only. [Chrome’s PWA debugging guide](https://developer.chrome.com/docs/devtools/progressive-web-apps/) · [MDN’s offline and background operation guide](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Offline_and_background_operation)

## Notifications

The inbox shows group invitations and open check-ins. System reminders are opt-in per device and open directly to Today. Lock-screen copy contains no goal names or notes. The message supports WebKit’s declarative format and the service worker handles delivery on other browsers. [WebKit’s push delivery guidance](https://webkit.org/blog/16535/)
