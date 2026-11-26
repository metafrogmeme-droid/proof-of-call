import { useEffect } from 'react';
import { Card, PublicNotice } from './components/common';
import { Header } from './components/Header';
import { useNetworkData } from './data';
import { defaultNetwork, networkByChainId } from './networks';
import { AboutPage } from './pages/AboutPage';
import { CallPage } from './pages/CallPage';
import { NetworkPage } from './pages/NetworkPage';
import { PublisherPage } from './pages/PublisherPage';
import { href, useRoute, type Route } from './router';
import { useWallet } from './wallet';

function chainIdOf(route: Route): number | undefined {
  if (route.page === 'network' || route.page === 'publisher') return route.chainId;
  if (route.page === 'call') return route.route.chainId;
  return undefined;
}

export function App() {
  const route = useRoute();
  const wallet = useWallet();
  const chainId = chainIdOf(route);
  const network = chainId === undefined ? defaultNetwork() : networkByChainId(chainId);
  const data = useNetworkData(network, wallet);

  useEffect(() => {
    if (route.page === 'home') {
      const n = defaultNetwork();
      if (n) window.location.replace(href.network(n.chainId));
    }
  }, [route]);

  let body;
  if (route.page === 'about') body = <AboutPage />;
  else if (chainId !== undefined && !network)
    body = <Card title="Unknown network">This app knows no deployment for chain id {chainId}.</Card>;
  else if (!network) body = <Card title="No network configured">This build contains no deployment records.</Card>;
  else if (route.page === 'publisher')
    body = <PublisherPage network={network} data={data} publisher={route.publisher} />;
  else if (route.page === 'call') body = <CallPage network={network} data={data} route={route.route} wallet={wallet} />;
  else if (route.page === 'not-found')
    body = (
      <Card title="Page not found">
        Nothing here. Go to the <a href={href.network(network.chainId)}>overview</a>.
      </Card>
    );
  else body = <NetworkPage network={network} data={data} />;

  return (
    <>
      <Header network={network} wallet={wallet} />
      <main className="main">{body}</main>
      <footer className="footer">
        <PublicNotice />
        <div className="footer-row">
          <span className="credit">HUMANOID-TRADERS · RUNECLAW</span>
          <p className="muted footer-meta">
            {data.source === 'wallet'
              ? 'Data read through your wallet’s connection.'
              : data.source === 'rpc' && network
                ? `Data read from the ${network.name} RPC.`
                : ''}{' '}
            {data.head !== null ? `Latest block ${data.head.toString()}.` : ''}{' '}
            {network?.proofOfCall ? (
              <button type="button" className="link" onClick={data.refresh}>
                Refresh
              </button>
            ) : null}
          </p>
        </div>
      </footer>
    </>
  );
}
