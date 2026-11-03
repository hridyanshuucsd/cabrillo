import React from 'react';
import { Link } from 'react-router-dom';
import { CONSENT } from './Login.jsx';

export default function About() {
  return (
    <div className="wrap stack">
      <div className="brand"><span className="brand-mark" aria-hidden="true">C</span>Cabrillo</div>
      <h1>About Cabrillo and the study</h1>
      <p>Cabrillo is a student project by Team 19 in COGS 123 (Social Computing) at UC San Diego. It explores how an AI that listens to a group chat can help small groups share what they know and reach a plan that works for everyone.</p>
      <div className="card stack">
        <h2>What we record</h2>
        <p className="small">{CONSENT}</p>
        <ul className="small" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.6 }}>
          <li>What happens in a session: plan choices, accepts, limits shared, AI messages, and timing.</li>
          <li>Chat messages and questions to the AI, stored under a player code.</li>
          <li>Your optional answers to the two questions after a game.</li>
          <li>For accounts only: your email and display name, used to sign in and show your history. Passwords are stored as secure hashes.</li>
        </ul>
        <p className="small muted" style={{ margin: 0 }}>Exports for analysis contain player codes, never names or emails. Data is used only for this course project.</p>
      </div>
      <div className="card stack">
        <h2>The AI</h2>
        <p className="small" style={{ margin: 0 }}>The AI is always labeled. At most tables it reads the chat, keeps the Plan so far, and asks a few questions; at some class tables it only answers when asked, so we can compare the two. It cannot see private limits and cannot vote. Anyone at the table can pause it. During class tests, a teammate may speak for it.</p>
      </div>
      <p className="small muted">The tasks use real San Diego place names, but every limit, price, and time in a session is invented for play.</p>
      <Link to="/" className="btn">Back</Link>
    </div>
  );
}
