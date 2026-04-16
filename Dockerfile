FROM quay.io/openstack.kolla/skyline-console:2024.2-ubuntu-noble
LABEL maintainer="Oussama Zaied"
LABEL version="2024.2-monitoring"

COPY skyline_console/static/ /tmp/new-static/

RUN cp -rf /tmp/new-static/* \
    /var/lib/kolla/venv/lib/python3.12/site-packages/skyline_console/static/ && \
    cp -rf /tmp/new-static/* \
    /skyline-console-source/skyline-console-5.0.1.dev4/skyline_console/static/ && \
    rm -rf /tmp/new-static

EXPOSE 9997
