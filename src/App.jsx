import EncoderPanel from "./components/EncoderPanel.jsx";
import DecoderPanel from "./components/DecoderPanel.jsx";
import "./App.css";

export default function App() {
  return (
    <div className="app">
      <header>
        <h1>Chess Steganography</h1>
        <p className="subtitle">Hide encrypted messages inside legal chess games</p>
      </header>
      <main className="panels">
        <EncoderPanel />
        <div className="divider" />
        <DecoderPanel />
      </main>
    </div>
  );
}
