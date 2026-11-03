import React from 'react';
import { Link } from 'react-router-dom';
import { CONSENT } from './Login.jsx';

export default function About() {
  return (
    <div className="wrap stack">
      <div className="brand"><span className="brand-mark" aria-hidden="true">C</span>Cabrillo</div>
      <h1>About Cabrillo and the study</h1>
      <p>Cabrillo is a student project by Team 19 in COGS 123 (Social Computing) at UC San Diego. It explores how small groups share private knowledge and reach a shared decision about a campus space.</p>
      <div className="card stack">
        <h2>What we record</h2>
        <p className="small">{CONSENT}</p>
        <ul className="small" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.6 }}>
          <li>Moves in the game: plan edits, accepts, facts shared, map layers viewed, and timing.</li>
          <li>Chat messages and questions to the AI, stored under a player code.</li>
          <li>Your optional answers to the two questions after a game.</li>
          <li>For accounts only: your email and display name, used to sign in and show your history. Passwords are stored as secure hashes.</li>
        </ul>
        <p className="small muted" style={{ margin: 0 }}>Exports for analysis contain player codes, never names or emails. Data is used only for this course project.</p>
      </div>
      <div className="card stack">
        <h2>The AI player</h2>
        <p className="small" style={{ margin: 0 }}>The Administrator is always labeled as AI. It keeps time, explains the rules, and answers questions from public map data. It cannot see private cards and cannot vote. During class tests, a teammate may speak for it.</p>
      </div>
      <p className="small muted">All places, roles, and facts in the game are fictional, even when they resemble real campus locations.</p>
      <Link to="/" className="btn">Back</Link>
    </div>
  );
}
