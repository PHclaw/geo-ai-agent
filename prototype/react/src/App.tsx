import { Routes, Route } from "react-router-dom";
import Layout from "./components/Layout";
import Login from "./pages/Login";
import Wizard from "./pages/Wizard";
import Dashboard from "./pages/Dashboard";
import Agent from "./pages/Agent";
import Answers from "./pages/Answers";
import Diagnosis from "./pages/Diagnosis";
import Evidence from "./pages/Evidence";
import PromptMatrix from "./pages/PromptMatrix";
import Knowledge from "./pages/Knowledge";
import KbDocs from "./pages/KbDocs";
import Products from "./pages/Products";
import Site from "./pages/Site";
import Seo from "./pages/Seo";
import Links from "./pages/Links";
import Plan from "./pages/Plan";
import Content from "./pages/Content";
import Avatar from "./pages/Avatar";
import Media from "./pages/Media";
import Monitor from "./pages/Monitor";
import Agency from "./pages/Agency";
import Ops from "./pages/Ops";
import Settings from "./pages/Settings";
import NotFound from "./pages/Placeholder";

export default function App() {
  return (
    <Routes>
      <Route path="login" element={<Login />} />
      <Route path="wizard" element={<Wizard />} />
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="agent" element={<Agent />} />
        <Route path="diagnosis" element={<Diagnosis />} />
        <Route path="answers" element={<Answers />} />
        <Route path="evidence" element={<Evidence />} />
        <Route path="prompts" element={<PromptMatrix />} />
        <Route path="knowledge" element={<Knowledge />} />
        <Route path="kb" element={<KbDocs />} />
        <Route path="products" element={<Products />} />
        <Route path="site" element={<Site />} />
        <Route path="content" element={<Content />} />
        <Route path="avatar" element={<Avatar />} />
        <Route path="media" element={<Media />} />
        <Route path="plan" element={<Plan />} />
        <Route path="links" element={<Links />} />
        <Route path="monitor" element={<Monitor />} />
        <Route path="seo" element={<Seo />} />
        <Route path="agency" element={<Agency />} />
        <Route path="ops" element={<Ops />} />
        <Route path="settings" element={<Settings />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
