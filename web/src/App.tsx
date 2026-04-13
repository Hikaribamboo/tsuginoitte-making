import React from 'react';
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';
import Layout from './components/Layout';
import PositionEditor from './pages/PositionEditor';
import FavoritesList from './pages/FavoritesList';
import ProblemCreator from './pages/ProblemCreator';
import PasteProblemCreator from './pages/PasteProblemCreator';
import WorkspaceList from './pages/WorkspaceList';

const PositionEditorWrapper: React.FC = () => {
  const location = useLocation();
  const state = location.state as {
    editId?: number;
    tags?: string[];
    sfen?: string;
  } | null;

  return (
    <PositionEditor
      key={state?.editId ?? 'new'}
      editId={state?.editId}
      initialTags={state?.tags ?? []}
      initialSfen={state?.sfen}
    />
  );
};

const App: React.FC = () => {
  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<PositionEditorWrapper />} />
          <Route path="/favorites" element={<FavoritesList />} />
          <Route path="/problem" element={<ProblemCreator />} />
          <Route path="/paste-problem" element={<PasteProblemCreator />} />
          <Route path="/workspaces" element={<WorkspaceList />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
};

export default App;
