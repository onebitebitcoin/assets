import { useEffect, useState } from "react";

const useMobile = (breakpoint = 640) => {
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === "undefined") {
      return false;
    }
    return window.matchMedia(`(max-width: ${breakpoint}px)`).matches;
  });

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }
    const media = window.matchMedia(`(max-width: ${breakpoint}px)`);
    const updateMatch = () => setIsMobile(media.matches);
    updateMatch();
    if (media.addEventListener) {
      media.addEventListener("change", updateMatch);
      return () => media.removeEventListener("change", updateMatch);
    }
    media.addListener(updateMatch);
    return () => media.removeListener(updateMatch);
  }, [breakpoint]);

  return isMobile;
};

export default useMobile;
