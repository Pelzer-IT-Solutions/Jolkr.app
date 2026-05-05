// Jolkr Service Worker — handles Web Push notifications

self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {};
  event.waitUntil(
    self.registration.showNotification(data.title || 'Jolkr', {
      body: data.body || '',
      icon: '/app/icon.svg',
      badge: '/app/icon.svg',
      tag: data.tag || 'jolkr',
      data: data.data || {},
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const { type, channel_id, dm_channel_id } = event.notification.data;
  let url = '/app/';
  if (type === 'dm' && dm_channel_id) {
    url = '/app/dm/' + dm_channel_id;
  }
  // For channel messages we'd need server_id to build the full URL,
  // which we don't have in the push payload — fall back to home.
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.includes('/app') && 'focus' in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      return clients.openWindow(url);
    })
  );
});
