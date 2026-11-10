import React, { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import './styles.css';
import { api, resetSocket } from './lib.js';
import { MeContext, useMe } from './me.js';
import Login from './pages/Login.jsx';
import Home from './pages/Home.jsx';
import Room from './pages/Room.jsx';
import Game from './pages/Game.jsx';
import Host from './pages/Host.jsx';
import History from './pages/History.jsx';
import About from './pages/About.jsx';
import Join from './pages/Join.jsx';
import Analytics from './pages/Analytics.jsx';


function App() {
  const [me, setMe] = useState(undefined);
  const refresh = useCallback(async () => { resetSocket(); setMe(await api('/api/me').catch(() => null)); }, []);
  useEffect(() => { refresh(); }, [refresh]);
  if (me === undefined) return <div className="wrap muted">Loading...</div>;
  return (
    <MeContext.Provider value={{ me, refresh }}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/about" element={<About />} />
        <Route path="/" element={<Need><Home /></Need>} />
        <Route path="/join/:code" element={<Join />} />
        <Route path="/room/:code" element={<Need><Room /></Need>} />
        <Route path="/quick" element={<Need><Room quick /></Need>} />
        <Route path="/play/:id" element={<Need><Game /></Need>} />
        <Route path="/host/:code" element={<Need><Host /></Need>} />
        <Route path="/analytics/:code" element={<Need><Analytics /></Need>} />
        <Route path="/history" element={<Need><History /></Need>} />
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </MeContext.Provider>
  );
}

function Need({ children }) {
  const { me } = useMe();
  const loc = useLocation();
  if (!me) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname)}`} replace />;
  return children;
}

createRoot(document.getElementById('root')).render(<BrowserRouter><App /></BrowserRouter>);
