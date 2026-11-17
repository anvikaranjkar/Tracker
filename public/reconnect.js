function retry() {
  if (location.pathname === '/offline.html') location.replace('/');
  else location.reload();
}

document.getElementById('retry').addEventListener('click', retry);
window.addEventListener('online', retry, { once: true });
