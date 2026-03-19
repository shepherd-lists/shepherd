const _ingressNodes = JSON.parse(process.env.ingress_nodes || '[]') as Array<{ url: string, name: string }>

export const ingressNodes = () => {
	if (_ingressNodes.length === 0) return []

	const nodes = [..._ingressNodes]

	/** Fisher-Yates shuffle for better randomization */
	for (let i = nodes.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		//swap nodes[i] and nodes[j]
		[nodes[i], nodes[j]] = [nodes[j]!, nodes[i]!]
	}

	return nodes
}
