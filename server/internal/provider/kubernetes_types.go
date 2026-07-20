package provider

type kubeVersion struct {
	GitVersion string `json:"gitVersion"`
}

type metadata struct {
	Name              string            `json:"name"`
	Namespace         string            `json:"namespace"`
	UID               string            `json:"uid"`
	Labels            map[string]string `json:"labels"`
	Annotations       map[string]string `json:"annotations"`
	CreationTimestamp string            `json:"creationTimestamp"`
	OwnerReferences   []ownerReference  `json:"ownerReferences"`
}

type ownerReference struct {
	Kind string `json:"kind"`
	Name string `json:"name"`
	UID  string `json:"uid"`
}

type condition struct {
	Type   string `json:"type"`
	Status string `json:"status"`
}

type kubeListMetadata struct {
	Continue string `json:"continue"`
}

type kubeList[T any] struct {
	Metadata kubeListMetadata `json:"metadata"`
	Items    []T              `json:"items"`
}

type eventList = kubeList[eventResource]

type eventResource struct {
	Metadata           metadata `json:"metadata"`
	Type               string   `json:"type"`
	Reason             string   `json:"reason"`
	Message            string   `json:"message"`
	FirstTimestamp     string   `json:"firstTimestamp"`
	LastTimestamp      string   `json:"lastTimestamp"`
	EventTime          string   `json:"eventTime"`
	ReportingComponent string   `json:"reportingComponent"`
	Source             struct {
		Component string `json:"component"`
		Host      string `json:"host"`
	} `json:"source"`
}

type namespaceList = kubeList[namespace]

type namespace struct {
	Metadata metadata `json:"metadata"`
}

type nodeList = kubeList[nodeResource]

type nodeResource struct {
	Metadata metadata `json:"metadata"`
	Status   struct {
		Conditions []condition       `json:"conditions"`
		Capacity   map[string]string `json:"capacity"`
		NodeInfo   struct {
			KubeletVersion string `json:"kubeletVersion"`
		} `json:"nodeInfo"`
	} `json:"status"`
}

type podList = kubeList[podResource]

type podResource struct {
	Metadata metadata `json:"metadata"`
	Spec     podSpec  `json:"spec"`
	Status   podStat  `json:"status"`
}

type podSpec struct {
	NodeName           string           `json:"nodeName"`
	ServiceAccountName string           `json:"serviceAccountName"`
	Containers         []container      `json:"containers"`
	InitContainers     []container      `json:"initContainers"`
	Volumes            []volume         `json:"volumes"`
	ImagePullSecret    []localObjectRef `json:"imagePullSecrets"`
}

type serviceAccountList = kubeList[serviceAccountResource]

type serviceAccountResource struct {
	Metadata metadata `json:"metadata"`
}

type configMapList = kubeList[configMapResource]

type configMapResource struct {
	Metadata   metadata          `json:"metadata"`
	Data       map[string]string `json:"data"`
	BinaryData map[string]string `json:"binaryData"`
	Immutable  *bool             `json:"immutable"`
}

type container struct {
	Name    string    `json:"name"`
	Env     []envVar  `json:"env"`
	EnvFrom []envFrom `json:"envFrom"`
}

type envFrom struct {
	ConfigMapRef *localObjectRef `json:"configMapRef"`
	SecretRef    *localObjectRef `json:"secretRef"`
}

type envVar struct {
	ValueFrom *envVarSource `json:"valueFrom"`
}

type envVarSource struct {
	ConfigMapKeyRef *localObjectRef `json:"configMapKeyRef"`
	SecretKeyRef    *localObjectRef `json:"secretKeyRef"`
}

type volume struct {
	ConfigMap             *configMapVolumeSource             `json:"configMap"`
	Secret                *secretVolumeSource                `json:"secret"`
	PersistentVolumeClaim *persistentVolumeClaimVolumeSource `json:"persistentVolumeClaim"`
}

type configMapVolumeSource struct {
	Name string `json:"name"`
}

type secretVolumeSource struct {
	SecretName string `json:"secretName"`
}

type persistentVolumeClaimVolumeSource struct {
	ClaimName string `json:"claimName"`
}

type localObjectRef struct {
	Name string `json:"name"`
}

type podStat struct {
	Phase             string            `json:"phase"`
	Conditions        []condition       `json:"conditions"`
	ContainerStatuses []containerStatus `json:"containerStatuses"`
}

type containerStatus struct {
	Ready        bool `json:"ready"`
	RestartCount int  `json:"restartCount"`
}

type serviceList = kubeList[serviceResource]

type serviceResource struct {
	Metadata metadata `json:"metadata"`
	Spec     struct {
		Type                     string            `json:"type"`
		ClusterIP                string            `json:"clusterIP"`
		ExternalName             string            `json:"externalName"`
		Selector                 map[string]string `json:"selector"`
		PublishNotReadyAddresses bool              `json:"publishNotReadyAddresses"`
		Ports                    []servicePort     `json:"ports"`
	} `json:"spec"`
}

type servicePort struct {
	Name     string `json:"name"`
	Protocol string `json:"protocol"`
	Port     int    `json:"port"`
}

type endpointSliceList = kubeList[endpointSliceResource]

type endpointSliceResource struct {
	Metadata    metadata   `json:"metadata"`
	AddressType string     `json:"addressType"`
	Endpoints   []endpoint `json:"endpoints"`
}

type endpoint struct {
	Addresses  []string `json:"addresses"`
	Conditions struct {
		Ready       *bool `json:"ready"`
		Serving     *bool `json:"serving"`
		Terminating *bool `json:"terminating"`
	} `json:"conditions"`
	TargetRef *objectReference `json:"targetRef"`
}

type objectReference struct {
	Kind      string `json:"kind"`
	Namespace string `json:"namespace"`
	Name      string `json:"name"`
}

type deploymentList = kubeList[deploymentResource]

type deploymentResource struct {
	Metadata metadata `json:"metadata"`
	Spec     struct {
		Replicas *int `json:"replicas"`
	} `json:"spec"`
	Status replicaStatus `json:"status"`
}

type replicaSetList = kubeList[replicaSetResource]

type replicaSetResource struct {
	Metadata metadata `json:"metadata"`
	Spec     struct {
		Replicas *int `json:"replicas"`
	} `json:"spec"`
	Status replicaStatus `json:"status"`
}

type statefulSetList = kubeList[statefulSetResource]

type statefulSetResource struct {
	Metadata metadata `json:"metadata"`
	Spec     struct {
		Replicas *int `json:"replicas"`
	} `json:"spec"`
	Status replicaStatus `json:"status"`
}

type daemonSetList = kubeList[daemonSetResource]

type daemonSetResource struct {
	Metadata metadata `json:"metadata"`
	Status   struct {
		DesiredNumberScheduled int `json:"desiredNumberScheduled"`
		NumberReady            int `json:"numberReady"`
	} `json:"status"`
}

type replicaStatus struct {
	Replicas          int `json:"replicas"`
	ReadyReplicas     int `json:"readyReplicas"`
	AvailableReplicas int `json:"availableReplicas"`
}

type jobList = kubeList[jobResource]

type jobResource struct {
	Metadata metadata `json:"metadata"`
	Spec     struct {
		Completions *int `json:"completions"`
	} `json:"spec"`
	Status struct {
		Active    int `json:"active"`
		Succeeded int `json:"succeeded"`
		Failed    int `json:"failed"`
	} `json:"status"`
}

type cronJobList = kubeList[cronJobResource]

type cronJobResource struct {
	Metadata metadata `json:"metadata"`
	Spec     struct {
		Schedule string `json:"schedule"`
		Suspend  *bool  `json:"suspend"`
	} `json:"spec"`
	Status struct {
		Active []objectReference `json:"active"`
	} `json:"status"`
}

type horizontalPodAutoscalerList = kubeList[horizontalPodAutoscalerResource]

type horizontalPodAutoscalerResource struct {
	Metadata metadata `json:"metadata"`
	Spec     struct {
		ScaleTargetRef objectReference `json:"scaleTargetRef"`
		MinReplicas    *int            `json:"minReplicas"`
		MaxReplicas    int             `json:"maxReplicas"`
	} `json:"spec"`
	Status struct {
		CurrentReplicas int `json:"currentReplicas"`
		DesiredReplicas int `json:"desiredReplicas"`
	} `json:"status"`
}

type ingressList = kubeList[ingressResource]

type ingressResource struct {
	Metadata metadata `json:"metadata"`
	Spec     struct {
		DefaultBackend *ingressBackend `json:"defaultBackend"`
		Rules          []ingressRule   `json:"rules"`
	} `json:"spec"`
}

type ingressRule struct {
	Host string `json:"host"`
	HTTP *struct {
		Paths []struct {
			Backend ingressBackend `json:"backend"`
		} `json:"paths"`
	} `json:"http"`
}

type ingressBackend struct {
	Service *struct {
		Name string `json:"name"`
	} `json:"service"`
}

type gatewayList = kubeList[gatewayResource]

type gatewayResource struct {
	Metadata metadata `json:"metadata"`
	Spec     struct {
		GatewayClassName string `json:"gatewayClassName"`
		Listeners        []struct {
			Name     string `json:"name"`
			Protocol string `json:"protocol"`
			Port     int    `json:"port"`
			Hostname string `json:"hostname"`
		} `json:"listeners"`
	} `json:"spec"`
}

type gatewayRouteList = kubeList[gatewayRouteResource]

type gatewayRouteResource struct {
	Metadata metadata `json:"metadata"`
	Spec     struct {
		Hostnames  []string           `json:"hostnames"`
		ParentRefs []gatewayReference `json:"parentRefs"`
		Rules      []gatewayRouteRule `json:"rules"`
	} `json:"spec"`
}

type gatewayReference struct {
	Group     string `json:"group"`
	Kind      string `json:"kind"`
	Namespace string `json:"namespace"`
	Name      string `json:"name"`
}

type gatewayRouteRule struct {
	BackendRefs []gatewayReference `json:"backendRefs"`
	Matches     []struct {
		Method struct {
			Service string `json:"service"`
			Method  string `json:"method"`
		} `json:"method"`
	} `json:"matches"`
}

type pvcList = kubeList[pvcResource]

type pvcResource struct {
	Metadata metadata `json:"metadata"`
	Spec     struct {
		Resources struct {
			Requests map[string]string `json:"requests"`
		} `json:"resources"`
		VolumeName       string `json:"volumeName"`
		StorageClassName string `json:"storageClassName"`
	} `json:"spec"`
	Status struct {
		Phase string `json:"phase"`
	} `json:"status"`
}

type pvList = kubeList[pvResource]

type pvResource struct {
	Metadata metadata `json:"metadata"`
	Spec     struct {
		Capacity         map[string]string `json:"capacity"`
		StorageClassName string            `json:"storageClassName"`
	} `json:"spec"`
	Status struct {
		Phase string `json:"phase"`
	} `json:"status"`
}

type storageClassList = kubeList[storageClassResource]

type storageClassResource struct {
	Metadata             metadata `json:"metadata"`
	Provisioner          string   `json:"provisioner"`
	VolumeBindingMode    string   `json:"volumeBindingMode"`
	AllowVolumeExpansion *bool    `json:"allowVolumeExpansion"`
}

type customResourceDefinitionList = kubeList[customResourceDefinitionResource]

type customResourceDefinitionResource struct {
	Metadata metadata `json:"metadata"`
	Spec     struct {
		Group string `json:"group"`
		Names struct {
			Kind       string   `json:"kind"`
			Plural     string   `json:"plural"`
			Singular   string   `json:"singular"`
			Categories []string `json:"categories"`
			ShortNames []string `json:"shortNames"`
		} `json:"names"`
		Scope    string `json:"scope"`
		Versions []struct {
			Name    string `json:"name"`
			Served  bool   `json:"served"`
			Storage bool   `json:"storage"`
		} `json:"versions"`
	} `json:"spec"`
	Status struct {
		Conditions []condition `json:"conditions"`
	} `json:"status"`
}

type customResourceInstanceList = kubeList[customResourceInstanceResource]

type customResourceInstanceResource struct {
	APIVersion string                 `json:"apiVersion"`
	Kind       string                 `json:"kind"`
	Metadata   metadata               `json:"metadata"`
	Spec       map[string]interface{} `json:"spec"`
	Status     map[string]interface{} `json:"status"`
}

type customResourceInstance struct {
	customResourceInstanceResource
	CRDName    string
	CRDGroup   string
	CRDVersion string
	CRDScope   string
}

type networkPolicyList = kubeList[networkPolicyResource]

type networkPolicyResource struct {
	Metadata metadata          `json:"metadata"`
	Spec     networkPolicySpec `json:"spec"`
}

type networkPolicySpec struct {
	PodSelector labelSelector              `json:"podSelector"`
	PolicyTypes []string                   `json:"policyTypes"`
	Ingress     []networkPolicyIngressRule `json:"ingress"`
	Egress      []networkPolicyEgressRule  `json:"egress"`
}

type networkPolicyIngressRule struct {
	From  []networkPolicyPeer `json:"from"`
	Ports []networkPolicyPort `json:"ports"`
}

type networkPolicyEgressRule struct {
	To    []networkPolicyPeer `json:"to"`
	Ports []networkPolicyPort `json:"ports"`
}

type networkPolicyPeer struct {
	PodSelector       *labelSelector        `json:"podSelector"`
	NamespaceSelector *labelSelector        `json:"namespaceSelector"`
	IPBlock           *networkPolicyIPBlock `json:"ipBlock"`
}

type networkPolicyIPBlock struct {
	CIDR   string   `json:"cidr"`
	Except []string `json:"except"`
}

type networkPolicyPort struct {
	Protocol string      `json:"protocol"`
	Port     interface{} `json:"port"`
	EndPort  *int        `json:"endPort"`
}

type labelSelector struct {
	MatchLabels      map[string]string              `json:"matchLabels"`
	MatchExpressions []labelSelectorMatchExpression `json:"matchExpressions"`
}

type labelSelectorMatchExpression struct {
	Key      string   `json:"key"`
	Operator string   `json:"operator"`
	Values   []string `json:"values"`
}
