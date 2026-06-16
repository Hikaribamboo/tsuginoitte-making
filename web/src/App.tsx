import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import ProblemCreator from './pages/ProblemCreator';
import PasteProblemCreator from './pages/PasteProblemCreator';
import WorkspaceList from './pages/WorkspaceList';
import ImagePositionCreator from './pages/ImagePositionCreator';
import MakingHome from './pages/MakingHome';
import ProductionReview from './pages/ProductionReview';
import MakingEngineCreator from './pages/MakingEngineCreator';
import MakingKifusGenerator from './pages/MakingKifusGenerator';

const App: React.FC = () => {
  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<Navigate to="/making" replace />} />
          <Route path="/problem" element={<ProblemCreator />} />
          <Route path="/paste-problem" element={<PasteProblemCreator />} />
          <Route path="/workspaces" element={<WorkspaceList />} />
          <Route path="/image-position" element={<ImagePositionCreator />} />
          <Route path="/making" element={<MakingHome />} />
          <Route path="/making/engine" element={<MakingEngineCreator />} />
          <Route path="/making/kifus" element={<MakingKifusGenerator />} />
          <Route path="/making/production" element={<ProductionReview />} />
          <Route path="/production" element={<ProductionReview />} />
          <Route
            path="/new-mode"
            element={<ProductionReview fixedMode="new_mode" title="新モード一覧" emptyText="新モードの下書きがありません。" />}
          />
          <Route path="*" element={<Navigate to="/making" replace />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
};

export default App;
