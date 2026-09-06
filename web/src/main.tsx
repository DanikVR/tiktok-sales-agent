import React from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, RouterProvider, Navigate } from 'react-router-dom';
import './index.css';
import './config/i18n';
import CommerceLayout from './layouts/CommerceLayout';
import CommerceHomePage from './pages/commerce/CommerceHomePage';
import CommerceOverviewPage from './pages/commerce/CommerceOverviewPage';
import CommerceCatalogPage from './pages/commerce/CommerceCatalogPage';
import CommerceWidgetSettingsPage from './pages/commerce/CommerceWidgetSettingsPage';
import CommerceDialogsPage from './pages/commerce/CommerceDialogsPage';
import CommerceLeadsPage from './pages/commerce/CommerceLeadsPage';
import CommerceMerchantPage from './pages/commerce/CommerceMerchantPage';
import CommerceSettingsPage from './pages/commerce/CommerceSettingsPage';
import CommerceWidgetPage from './pages/embed/CommerceWidgetPage';

const router = createBrowserRouter([
  { path: '/', element: <Navigate to="/commerce" replace /> },
  { path: '/console', element: <Navigate to="/commerce" replace /> },
  { path: '/embed/commerce/:slug', element: <CommerceWidgetPage /> },
  { path: '/c/:slug', element: <CommerceWidgetPage hosted /> },
  {
    path: '/commerce',
    element: <CommerceLayout />,
    children: [
      { index: true, element: <CommerceHomePage /> },
      { path: 'stats', element: <CommerceOverviewPage /> },
      { path: 'catalog', element: <CommerceCatalogPage /> },
      { path: 'widget', element: <CommerceWidgetSettingsPage /> },
      { path: 'dialogs', element: <CommerceDialogsPage /> },
      { path: 'dialogs/:id', element: <CommerceDialogsPage /> },
      { path: 'leads', element: <CommerceLeadsPage /> },
      { path: 'agent', element: <CommerceMerchantPage /> },
      { path: 'settings', element: <CommerceSettingsPage /> },
    ],
  },
]);

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><RouterProvider router={router} /></React.StrictMode>);
