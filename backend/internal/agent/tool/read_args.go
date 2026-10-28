package tool

// The same types drive strict argument decoding in the host and schema creation.
// omitempty controls required fields in the schema, not runtime zero handling.
type CanvasGetStateArgs struct {
	Offset           int      `json:"offset,omitempty" description:"Node page start, default 0; continue with nextOffset (not a page number)" minimum:"0"`
	ConnectionOffset int      `json:"connectionOffset,omitempty" description:"Edge page start; when hasMoreConnections, keep the node offset and use nextConnectionOffset" minimum:"0"`
	StoryboardOffset int      `json:"storyboardOffset,omitempty" description:"Storyboard row page start, 0 when omitted" minimum:"0"`
	NodeIDs          []string `json:"nodeIds,omitempty" description:"Array of node IDs (not a single string); mutually exclusive with focusNodeIds" itemDescription:"Real ID of a node to read in detail" maxItems:"8"`
	FocusNodeIDs     []string `json:"focusNodeIds,omitempty" description:"Read the linked subgraph together with depth; do not pass depth without it" itemDescription:"Real ID of the current node or node set" maxItems:"8"`
	Depth            *int     `json:"depth,omitempty" description:"Expand from focusNodeIds along undirected edges; default 1; do not pass without focusNodeIds" minimum:"0" maximum:"3"`
	IncludeRelated   *bool    `json:"includeRelated,omitempty" description:"Only with focusNodeIds; true reads every upstream and downstream node of the connected component, up to 256 nodes; mutually exclusive with depth"`
}

type CanvasReadTextArgs struct {
	NodeID   string `json:"nodeId" description:"Text or file node ID"`
	Offset   int    `json:"offset,omitempty" description:"Character offset; continue with nextOffset" minimum:"0"`
	MaxChars int    `json:"maxChars,omitempty" description:"Maximum characters, default 16000" minimum:"1" maximum:"16000"`
}

type StoryboardReadArgs struct {
	NodeID string `json:"nodeId" description:"Real storyboard node ID"`
	Offset int    `json:"offset,omitempty" minimum:"0"`
}

type BatchTableReadArgs struct {
	NodeID string `json:"nodeId" description:"Real batch table node ID"`
	Offset int    `json:"offset,omitempty" minimum:"0"`
}

type SkillReadArgs struct {
	SkillID string `json:"skillId" description:"Skill ID"`
	Path    string `json:"path" description:"File path or empty string"`
	Offset  int    `json:"offset,omitempty" minimum:"0"`
}

type ProfileReadArgs struct {
	Scope string `json:"scope" enum:"user,project,canvas"`
}

type TaskGetArgs struct {
	TaskID string `json:"taskId" description:"Real task ID"`
}

type ImageNodeArgs struct {
	NodeID string `json:"nodeId" description:"Real image node ID"`
}
