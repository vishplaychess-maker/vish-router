import { BrowserRouter, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import Chat from './pages/Chat'
import Docs from './pages/Docs'
import ModelLibrary from './pages/ModelLibrary'
import NotFound from './pages/NotFound'
import Pricing from './pages/Pricing'
import Rankings from './pages/Rankings'

/**
 * Application routes.
 *
 * A single pathless layout route wraps every page, so the Navbar mounts once
 * and stays put while the content beneath it changes.
 *
 *   /          Model Library
 *   /rankings  Rankings
 *   /pricing   Pricing
 *   /chat      Chat
 *   /docs      Docs
 *   *          Not found
 */
export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<ModelLibrary />} />
          <Route path="/rankings" element={<Rankings />} />
          <Route path="/pricing" element={<Pricing />} />
          <Route path="/chat" element={<Chat />} />
          <Route path="/docs" element={<Docs />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
