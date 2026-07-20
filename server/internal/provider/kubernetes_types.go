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
	Status   nodeStat `json:"status"`
}

type nodeStat struct {
	Conditions  []condition       `json:"conditions"`
	Capacity    map[string]string `json:"capacity"`
	Allocatable map[string]string `json:"allocatable"`
	NodeInfo    nodeSystemInfo    `json:"nodeInfo"`
}

type nodeSystemInfo struct {
	KubeletVersion          string `json:"kubeletVersion"`
	ContainerRuntimeVersion string `json:"containerRuntimeVersion"`
	OperatingSystem         string `json:"operatingSystem"`
	Architecture            string `json:"architecture"`
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
	Metadata   metadata           `json:"metadata"`
	Data       configMapKeyIndex  `json:"data"`
	BinaryData configMapKeyIndex  `json:"binaryData"`
	Immutable  configMapImmutable `json:"immutable"`
}

type container struct {
	Name    string    `json:"name"`
	Image   string    `json:"image"`
	Env     []envVar  `json:"env"`
	EnvFrom []envFrom `json:"envFrom"`
}

type podTemplateSpec struct {
	Spec podSpec `json:"spec"`
}

type envFrom struct {
	ConfigMapRef *localObjectRef `json:"configMapRef"`
	SecretRef    *localObjectRef `json:"secretRef"`
}

type envVar struct {
	ValueFrom *envVarSource `json:"valueFrom"`
}

type envVarSource struct {
	ConfigMapKeyRef  *localObjectRef `json:"configMapKeyRef"`
	SecretKeyRef     *localObjectRef `json:"secretKeyRef"`
	FieldRef         *struct{}       `json:"fieldRef"`
	ResourceFieldRef *struct{}       `json:"resourceFieldRef"`
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
	Phase                      string            `json:"phase"`
	Conditions                 []condition       `json:"conditions"`
	ContainerStatuses          []containerStatus `json:"containerStatuses"`
	InitContainerStatuses      []containerStatus `json:"initContainerStatuses"`
	EphemeralContainerStatuses []containerStatus `json:"ephemeralContainerStatuses"`
}

type containerStatus struct {
	Name         string         `json:"name"`
	Ready        bool           `json:"ready"`
	RestartCount int            `json:"restartCount"`
	Image        string         `json:"image"`
	State        containerState `json:"state"`
	LastState    containerState `json:"lastState"`
}

type containerState struct {
	Waiting    *containerStateWaiting    `json:"waiting"`
	Running    *struct{}                 `json:"running"`
	Terminated *containerStateTerminated `json:"terminated"`
}

type containerStateWaiting struct {
	Reason string `json:"reason"`
}

type containerStateTerminated struct {
	ExitCode *int   `json:"exitCode"`
	Signal   int    `json:"signal"`
	Reason   string `json:"reason"`
}

type serviceList = kubeList[serviceResource]

type serviceResource struct {
	Metadata metadata `json:"metadata"`
	Spec     struct {
		Type                          string                        `json:"type"`
		ClusterIP                     string                        `json:"clusterIP"`
		ClusterIPs                    []string                      `json:"clusterIPs"`
		IPFamilies                    []string                      `json:"ipFamilies"`
		IPFamilyPolicy                string                        `json:"ipFamilyPolicy"`
		InternalTrafficPolicy         string                        `json:"internalTrafficPolicy"`
		ExternalTrafficPolicy         string                        `json:"externalTrafficPolicy"`
		SessionAffinity               string                        `json:"sessionAffinity"`
		SessionAffinityConfig         *serviceSessionAffinityConfig `json:"sessionAffinityConfig"`
		HealthCheckNodePort           int                           `json:"healthCheckNodePort"`
		LoadBalancerClass             string                        `json:"loadBalancerClass"`
		AllocateLoadBalancerNodePorts *bool                         `json:"allocateLoadBalancerNodePorts"`
		ExternalIPs                   []string                      `json:"externalIPs"`
		LoadBalancerSourceRanges      []string                      `json:"loadBalancerSourceRanges"`
		TrafficDistribution           string                        `json:"trafficDistribution"`
		DeprecatedLoadBalancerIP      serviceDeprecatedIPAddress    `json:"loadBalancerIP"`
		ExternalName                  string                        `json:"externalName"`
		Selector                      map[string]string             `json:"selector"`
		PublishNotReadyAddresses      bool                          `json:"publishNotReadyAddresses"`
		Ports                         []servicePort                 `json:"ports"`
	} `json:"spec"`
}

type serviceSessionAffinityConfig struct {
	ClientIP *serviceClientIPConfig `json:"clientIP"`
}

type serviceClientIPConfig struct {
	TimeoutSeconds *int `json:"timeoutSeconds"`
}

type serviceDeprecatedIPAddress struct {
	Set        bool
	Configured bool
	Valid      bool
}

type servicePort struct {
	Name        string            `json:"name"`
	Protocol    string            `json:"protocol"`
	Port        int               `json:"port"`
	TargetPort  serviceTargetPort `json:"targetPort"`
	NodePort    int               `json:"nodePort"`
	AppProtocol string            `json:"appProtocol"`
}

type serviceTargetPort struct {
	Kind        string
	IntValue    int
	StringValue string
	Set         bool
	Valid       bool
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
		Replicas *int            `json:"replicas"`
		Template podTemplateSpec `json:"template"`
	} `json:"spec"`
	Status replicaStatus `json:"status"`
}

type replicaSetList = kubeList[replicaSetResource]

type replicaSetResource struct {
	Metadata metadata `json:"metadata"`
	Spec     struct {
		Replicas *int            `json:"replicas"`
		Template podTemplateSpec `json:"template"`
	} `json:"spec"`
	Status replicaStatus `json:"status"`
}

type statefulSetList = kubeList[statefulSetResource]

type statefulSetResource struct {
	Metadata metadata `json:"metadata"`
	Spec     struct {
		Replicas *int            `json:"replicas"`
		Template podTemplateSpec `json:"template"`
	} `json:"spec"`
	Status replicaStatus `json:"status"`
}

type daemonSetList = kubeList[daemonSetResource]

type daemonSetResource struct {
	Metadata metadata `json:"metadata"`
	Spec     struct {
		Template podTemplateSpec `json:"template"`
	} `json:"spec"`
	Status struct {
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
		Completions *int            `json:"completions"`
		Template    podTemplateSpec `json:"template"`
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
		Schedule    string `json:"schedule"`
		Suspend     *bool  `json:"suspend"`
		JobTemplate struct {
			Spec struct {
				Template podTemplateSpec `json:"template"`
			} `json:"spec"`
		} `json:"jobTemplate"`
	} `json:"spec"`
	Status struct {
		Active []objectReference `json:"active"`
	} `json:"status"`
}

type horizontalPodAutoscalerList = kubeList[horizontalPodAutoscalerResource]

type horizontalPodAutoscalerResource struct {
	Metadata metadata `json:"metadata"`
	Spec     struct {
		ScaleTargetRef hpaScaleTargetReference `json:"scaleTargetRef"`
		MinReplicas    *int                    `json:"minReplicas"`
		MaxReplicas    *int                    `json:"maxReplicas"`
		Metrics        []hpaMetricSpec         `json:"metrics"`
	} `json:"spec"`
	Status struct {
		CurrentReplicas *int              `json:"currentReplicas"`
		DesiredReplicas *int              `json:"desiredReplicas"`
		CurrentMetrics  []hpaMetricStatus `json:"currentMetrics"`
		Conditions      []condition       `json:"conditions"`
	} `json:"status"`
}

type hpaScaleTargetReference struct {
	APIVersion string `json:"apiVersion"`
	Kind       string `json:"kind"`
	Name       string `json:"name"`
}

type hpaMetricSpec struct {
	Valid      bool
	SourceType string
	TargetType string
}

type hpaMetricStatus struct {
	Valid       bool
	SourceType  string
	CurrentType string
}

type ingressList = kubeList[ingressResource]

type ingressResource struct {
	Metadata metadata `json:"metadata"`
	Spec     struct {
		IngressClassName string             `json:"ingressClassName"`
		DefaultBackend   *ingressBackend    `json:"defaultBackend"`
		Rules            []ingressRule      `json:"rules"`
		TLS              []ingressTLSConfig `json:"tls"`
	} `json:"spec"`
	Status struct {
		LoadBalancer struct {
			Ingress []ingressLoadBalancerPoint `json:"ingress"`
		} `json:"loadBalancer"`
	} `json:"status"`
}

type ingressRule struct {
	Host string `json:"host"`
	HTTP *struct {
		Paths []struct {
			Path     string         `json:"path"`
			PathType string         `json:"pathType"`
			Backend  ingressBackend `json:"backend"`
		} `json:"paths"`
	} `json:"http"`
}

type ingressBackend struct {
	Service  *ingressServiceBackend `json:"service"`
	Resource *struct {
		APIGroup string `json:"apiGroup"`
		Kind     string `json:"kind"`
		Name     string `json:"name"`
	} `json:"resource"`
}

type ingressServiceBackend struct {
	Name string `json:"name"`
	Port struct {
		Name   string `json:"name"`
		Number int    `json:"number"`
	} `json:"port"`
}

type ingressTLSConfig struct {
	Hosts      []string `json:"hosts"`
	SecretName string   `json:"secretName"`
}

type ingressLoadBalancerPoint struct {
	Valid      bool
	Kind       string
	PortCount  int
	ErrorCount int
}

type gatewayList = kubeList[gatewayResource]

type gatewayResource struct {
	Metadata metadata `json:"metadata"`
	Spec     struct {
		GatewayClassName string            `json:"gatewayClassName"`
		Addresses        []gatewayAddress  `json:"addresses"`
		Listeners        []gatewayListener `json:"listeners"`
	} `json:"spec"`
	Status struct {
		Addresses  []gatewayAddress        `json:"addresses"`
		Conditions []condition             `json:"conditions"`
		Listeners  []gatewayListenerStatus `json:"listeners"`
	} `json:"status"`
}

type gatewayListener struct {
	Name     string `json:"name"`
	Protocol string `json:"protocol"`
	Port     int    `json:"port"`
	Hostname string `json:"hostname"`
}

type gatewayAddress struct {
	Valid      bool
	Configured bool
	Kind       string
	Deprecated bool
}

type gatewayListenerStatus struct {
	Name           string      `json:"name"`
	AttachedRoutes int         `json:"attachedRoutes"`
	Conditions     []condition `json:"conditions"`
}

type gatewayRouteList = kubeList[gatewayRouteResource]

type gatewayRouteResource struct {
	Metadata metadata `json:"metadata"`
	Spec     struct {
		Hostnames  []string           `json:"hostnames"`
		ParentRefs []gatewayReference `json:"parentRefs"`
		Rules      []gatewayRouteRule `json:"rules"`
	} `json:"spec"`
	Status struct {
		Parents []gatewayRouteParentStatus `json:"parents"`
	} `json:"status"`
}

type gatewayReference struct {
	Group       string `json:"group"`
	Kind        string `json:"kind"`
	Namespace   string `json:"namespace"`
	Name        string `json:"name"`
	SectionName string `json:"sectionName"`
	Port        int    `json:"port"`
}

type gatewayRouteParentStatus struct {
	Conditions []condition `json:"conditions"`
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
	Spec     pvcSpec  `json:"spec"`
	Status   pvcStat  `json:"status"`
}

type pvcSpec struct {
	AccessModes []string `json:"accessModes"`
	Resources   struct {
		Requests map[string]string `json:"requests"`
	} `json:"resources"`
	VolumeName       string `json:"volumeName"`
	StorageClassName string `json:"storageClassName"`
	VolumeMode       string `json:"volumeMode"`
}

type pvcStat struct {
	Phase       string            `json:"phase"`
	AccessModes []string          `json:"accessModes"`
	Capacity    map[string]string `json:"capacity"`
}

type pvList = kubeList[pvResource]

type pvResource struct {
	Metadata metadata `json:"metadata"`
	Spec     pvSpec   `json:"spec"`
	Status   pvStat   `json:"status"`
}

type pvSpec struct {
	Capacity                      map[string]string `json:"capacity"`
	AccessModes                   []string          `json:"accessModes"`
	PersistentVolumeReclaimPolicy string            `json:"persistentVolumeReclaimPolicy"`
	StorageClassName              string            `json:"storageClassName"`
	VolumeMode                    string            `json:"volumeMode"`
}

type pvStat struct {
	Phase string `json:"phase"`
}

type storageClassList = kubeList[storageClassResource]

type storageClassResource struct {
	Metadata             metadata `json:"metadata"`
	Provisioner          string   `json:"provisioner"`
	ReclaimPolicy        string   `json:"reclaimPolicy"`
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
