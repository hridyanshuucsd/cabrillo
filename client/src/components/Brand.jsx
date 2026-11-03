import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib.js';
import { useMe } from '../me.js';

export default function TopBar({ back }) {
  const { me, refresh } = useMe();
  const nav = useNavigate();
  return (
    <div className="topbar">
      <Link to="/" className="brand" style={{ textDecoration: 'none', color: 'inherit' }}>
        <span className="brand-mark" aria-hidden="true">C</span>Cabrillo
      </Link>
      <div className="row">
        {back && <Link to="/" className="linkbtn">Home</Link>}
        {me && (
          <button className="linkbtn" onClick={async () => { await api('/api/logout', {}); await refresh(); nav('/login'); }}>
            Sign out
          </button>
        )}
      </div>
    </div>
  );
}
