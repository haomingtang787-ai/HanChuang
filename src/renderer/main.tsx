import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HanchuangApp } from './hanchuang/HanchuangApp'
import 'katex/dist/katex.min.css'
import './hanchuang/hanchuang.css'

const root = document.getElementById('root')
if (root) createRoot(root).render(<StrictMode><HanchuangApp /></StrictMode>)