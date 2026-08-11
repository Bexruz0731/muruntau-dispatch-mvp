import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/layout/Layout';
import MapPage from './pages/MapPage';
import FuelReportPage from './pages/FuelReportPage';
import AssistantPage from './pages/AssistantPage';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Navigate to="/map" replace />} />
          <Route path="/map" element={<MapPage />} />
          <Route path="/fuel-report" element={<FuelReportPage />} />
          <Route path="/assistant" element={<AssistantPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
