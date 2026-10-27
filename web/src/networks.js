export const PUBLIC_NETWORKS = {
  11155111: {
    name: "Ethereum Sepolia", deployment: "sepolia", rpcUrl: "https://ethereum-sepolia-rpc.publicnode.com",
    explorerUrl: "https://sepolia.etherscan.io"
  },
  84532: {
    name: "Base Sepolia", deployment: "baseSepolia", rpcUrl: "https://sepolia.base.org",
    explorerUrl: "https://sepolia.basescan.org"
  }
};

export async function switchWalletNetwork(ethereum, chainId) {
  const network = PUBLIC_NETWORKS[chainId];
  if (!network) throw new Error("Unsupported network.");
  const hexChainId = `0x${Number(chainId).toString(16)}`;
  try {
    await ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hexChainId }] });
  } catch (error) {
    if (Number(error.code ?? error.data?.originalError?.code) !== 4902) throw error;
    await ethereum.request({
      method: "wallet_addEthereumChain",
      params: [{
        chainId: hexChainId, chainName: network.name,
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: [network.rpcUrl], blockExplorerUrls: [network.explorerUrl]
      }]
    });
    await ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hexChainId }] });
  }
}

export async function loadNetworkDeployment(chainId, baseUrl, fetcher = fetch) {
  const network = PUBLIC_NETWORKS[chainId];
  if (!network) throw new Error("Unsupported network.");
  const response = await fetcher(`${baseUrl}deployments/${network.deployment}.json`, { cache: "no-store" });
  if (!response.ok) throw new Error(`Unable to load ${network.name} deployment.`);
  const deployment = await response.json();
  if (Number(deployment.chainId) !== Number(chainId)) throw new Error("Deployment chain ID does not match the selected network.");
  return deployment;
}
