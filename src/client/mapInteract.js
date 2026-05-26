async function placeGuess(page, lat, lng) {
  await page.evaluate(async (lat, lng) => {
    const getMapContainer = () =>
      document.querySelector('[class^="guess-map_canvasContainer__"]');

    const findReactFiber = (el) => {
      const key = Object.keys(el).find((k) => k.startsWith("__reactFiber$"));
      return key ? el[key] : null;
    };

    const findMapInstance = () => {
      const el = getMapContainer();
      const fiber = findReactFiber(el);
      if (!fiber) return null;
      let current = fiber;
      for (let i = 0; i < 20 && current; i++) {
        const map = current.memoizedProps?.map;
        if (map?.__e3_?.click) return map;
        current = current.return;
      }
      return null;
    };

    const map = findMapInstance();
    if (!map || !window.google) {
      console.log("[DEBUG] No map instance or google object found");
      return;
    }

    google.maps.event.trigger(map, "click", { latLng: new google.maps.LatLng(lat, lng) });
    console.log("[DEBUG] Marker placed at", lat, lng);

    await new Promise((resolve) => setTimeout(resolve, 500));

    const guessButton = document.querySelector('button[data-qa="perform-guess"]');
    if (guessButton) {
      guessButton.click();
      console.log("Clicked guess button");
    }
  }, lat, lng);
}

module.exports = { placeGuess };
