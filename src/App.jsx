import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/layout/Layout';
import MapPage from './pages/MapPage';
import FuelReportPage from './pages/FuelReportPage';
import AssistantPage from './pages/AssistantPage';
import { useSimulationStore } from './simulation/store';

export default function App() {
  const startSimulation = useSimulationStore((s) => s.startSimulation);
  const fetchFleetNorm = useSimulationStore((s) => s.fetchFleetNorm);

  useEffect(() => {
    startSimulation();
    fetchFleetNorm();
  }, [startSimulation, fetchFleetNorm]);

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
