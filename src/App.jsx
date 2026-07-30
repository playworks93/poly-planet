import { useState } from "react";
import { Analytics } from "@vercel/analytics/react";
import PolyPlanet from "./components/PolyPlanet.jsx";
import SceneErrorBoundary from "./components/SceneErrorBoundary.jsx";
import SceneUnavailable from "./components/SceneUnavailable.jsx";
import { isWebGLAvailable } from "./lib/webgl.js";

export default function App() {
  // Probed once, before the scene mounts, so an unsupported browser gets an
  // explanation instead of a blank page. The boundary is the backstop for
  // anything that still fails during three.js setup.
  const [webgl] = useState(isWebGLAvailable);

  if (!webgl) return (
    <>
      <SceneUnavailable />
      <Analytics />
    </>
  );

  return (
    <>
      <SceneErrorBoundary>
        <PolyPlanet />
      </SceneErrorBoundary>
      <Analytics />
    </>
  );
}
