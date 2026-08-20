pipeline {
    agent any

    environment {
        // Nombre de la imagen que generaremos
        IMAGE_NAME = 'msms-backend'
        // Puedes configurar la URL de tu registro Docker (Nexus, Docker Hub, ECR, etc.)
        REGISTRY = 'tu-registro-docker.com' 
    }

    stages {
        stage('Checkout') {
            steps {
                // Descarga el código del repositorio
                checkout scm
            }
        }

        stage('Install & Test') {
            steps {
                // Instala dependencias y corre tests usando el entorno local de Jenkins o un contenedor Node
                sh 'npm ci'
                sh 'npx prisma generate'
                sh 'npm run test'
            }
        }

        stage('Build Image (Podman)') {
            steps {
                // Usando podman en lugar de docker
                sh 'podman build -t ${IMAGE_NAME}:${env.BUILD_ID} .'
                sh 'podman tag ${IMAGE_NAME}:${env.BUILD_ID} ${IMAGE_NAME}:latest'
            }
        }

        /* 
        // Descomenta este bloque cuando tengas el registro listo para subir la imagen
        stage('Push Image') {
            steps {
                sh 'podman push ${IMAGE_NAME}:${env.BUILD_ID} docker://${REGISTRY}/${IMAGE_NAME}:${env.BUILD_ID}'
                sh 'podman push ${IMAGE_NAME}:latest docker://${REGISTRY}/${IMAGE_NAME}:latest'
            }
        }
        */

       /*
       // Etapa opcional para desplegar usando podman-compose o scripts
       stage('Deploy') {
           steps {
               sh 'podman-compose up -d'
           }
       }
       */
    }

    post {
        always {
            // Limpia el workspace al terminar
            cleanWs()
        }
        success {
            echo '¡Pipeline ejecutado con éxito!'
        }
        failure {
            echo 'Error en la ejecución del pipeline. Revisa los logs.'
        }
    }
}
