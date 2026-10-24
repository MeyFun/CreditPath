// Выбранная тема применяется до отрисовки, чтобы страница не мигала светлой. Без выбора — тема системы.
try {
  var saved = localStorage.getItem("creditpath-theme");
  if (saved === "dark" || saved === "light") document.documentElement.dataset.theme = saved;
} catch (error) {
  // Хранилище недоступно (приватный режим): остаёмся на теме системы.
}
