import React from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';
import './navigation.css';
import { App } from './App.js';
import { installImageFallback } from './image-fallback.js';

installImageFallback();
createRoot(document.getElementById('root')!).render(<App />);
