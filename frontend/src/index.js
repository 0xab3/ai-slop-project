import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Landing from './Landing';
import Chat from './Chat';
import Manual from './Manual';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/chat/:roomId?" element={<Chat />} />
        <Route path="/manual" element={<Manual />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
