import { Component } from "react";
import SceneUnavailable from "./SceneUnavailable.jsx";

/* Catches anything the scene throws on the way up — including errors raised
   inside useEffect during mount, which is where three.js initialisation
   happens. Without this, such a throw unmounts the tree and leaves a blank
   page with no explanation. */
export default class SceneErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error) {
    // Keep the detail in the console for anyone debugging a real device.
    console.error("Poly Planet failed to start:", error);
  }

  render() {
    return this.state.failed ? <SceneUnavailable /> : this.props.children;
  }
}
