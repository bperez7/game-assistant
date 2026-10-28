import { useState } from "react";

export default function App() {
  const [message, setMessage] = useState("Click to call the backend.");

  async function callBackend() {
    try {
      const response = await fetch("/api/hello");

      if (!response.ok) {
        throw new Error(`Request failed: ${response.status}`);
      }

      const data: { message: string } = await response.json();
      setMessage(data.message);
    } catch {
      setMessage("Couldn't reach the backend.");
    }
  }

  return (
    <main>
      <h1>My Project</h1>
      <p>{message}</p>
      <button onClick={callBackend}>Call backend</button>
    </main>
  );
}