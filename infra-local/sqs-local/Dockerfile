FROM softwaremill/elasticmq-native 

COPY elasticmq.conf /opt/elasticmq.conf

ARG EXTRA_QUEUES
USER root
## convert commas to spaces and add queues
RUN QUEUES="$(echo "$EXTRA_QUEUES" | sed 'y/,/ /')"; \
		for QUEUE in $QUEUES; do \
			echo "queues { $QUEUE {} }" >> /opt/elasticmq.conf; \
		done;

