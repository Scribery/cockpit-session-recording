FROM fedora:35

COPY . cockpit-session-recording

RUN sudo dnf -y install \
        git \
        gnupg \
        intltool \
        libappstream-glib \
        python3 \
        make \
        npm \
        rpm-build \
        rpmdevtools \
        rsync \
        tar

RUN cd cockpit-session-recording && make rpm
